-- Shared cross-isolate / cross-function rate limiter for GHL tokens
CREATE TABLE IF NOT EXISTS public.ghl_rate_state (
  token_key       TEXT PRIMARY KEY,
  window_start_ms BIGINT NOT NULL DEFAULT 0,
  window_count    INT    NOT NULL DEFAULT 0,
  cooldown_until_ms BIGINT NOT NULL DEFAULT 0,
  last_429_at     TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ghl_rate_state ENABLE ROW LEVEL SECURITY;
-- No policies → only service_role (which bypasses RLS) can read/write.

-- Atomic "try to reserve a slot". Returns ms to wait before retrying (0 = granted).
CREATE OR REPLACE FUNCTION public.ghl_rate_reserve(
  p_token_key TEXT,
  p_max_per_window INT,
  p_window_ms INT
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now_ms     BIGINT := (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT;
  v_row        public.ghl_rate_state%ROWTYPE;
  v_wait_ms    BIGINT := 0;
BEGIN
  -- Upsert row, then lock it
  INSERT INTO public.ghl_rate_state(token_key, window_start_ms, window_count)
  VALUES (p_token_key, v_now_ms, 0)
  ON CONFLICT (token_key) DO NOTHING;

  SELECT * INTO v_row FROM public.ghl_rate_state
  WHERE token_key = p_token_key FOR UPDATE;

  -- Cooldown still active?
  IF v_row.cooldown_until_ms > v_now_ms THEN
    RETURN v_row.cooldown_until_ms - v_now_ms;
  END IF;

  -- Roll the window forward
  IF v_now_ms - v_row.window_start_ms >= p_window_ms THEN
    v_row.window_start_ms := v_now_ms;
    v_row.window_count    := 0;
  END IF;

  IF v_row.window_count >= p_max_per_window THEN
    v_wait_ms := (v_row.window_start_ms + p_window_ms) - v_now_ms;
    IF v_wait_ms < 0 THEN v_wait_ms := 0; END IF;
    UPDATE public.ghl_rate_state
       SET window_start_ms = v_row.window_start_ms,
           window_count    = v_row.window_count,
           updated_at      = now()
     WHERE token_key = p_token_key;
    RETURN v_wait_ms;
  END IF;

  UPDATE public.ghl_rate_state
     SET window_start_ms = v_row.window_start_ms,
         window_count    = v_row.window_count + 1,
         updated_at      = now()
   WHERE token_key = p_token_key;
  RETURN 0;
END;
$$;

-- Force a global cooldown after a 429
CREATE OR REPLACE FUNCTION public.ghl_rate_note_429(
  p_token_key TEXT,
  p_cooldown_ms INT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now_ms BIGINT := (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT;
BEGIN
  INSERT INTO public.ghl_rate_state(token_key, cooldown_until_ms, last_429_at, window_count, window_start_ms)
  VALUES (p_token_key, v_now_ms + p_cooldown_ms, now(), 0, v_now_ms)
  ON CONFLICT (token_key) DO UPDATE
    SET cooldown_until_ms = GREATEST(public.ghl_rate_state.cooldown_until_ms, v_now_ms + p_cooldown_ms),
        last_429_at       = now(),
        window_count      = 0,
        window_start_ms   = v_now_ms,
        updated_at        = now();
END;
$$;

REVOKE ALL ON FUNCTION public.ghl_rate_reserve(TEXT, INT, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ghl_rate_note_429(TEXT, INT)     FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.ghl_rate_reserve(TEXT, INT, INT) TO service_role;
GRANT  EXECUTE ON FUNCTION public.ghl_rate_note_429(TEXT, INT)     TO service_role;