export type MarketErrorCode =
  | 'function_missing' | 'migration_missing' | 'rls_denied' | 'session_expired'
  | 'provider_not_configured' | 'provider_unauthorised' | 'provider_payment_required'
  | 'provider_rate_limited' | 'provider_timeout' | 'source_fetch_failed'
  | 'source_parse_failed' | 'source_validation_failed' | 'database_insert_failed'
  | 'digest_failed' | 'cron_missing' | 'cron_stale' | 'unknown';

const CORRELATION_ID_RE=/^[a-zA-Z0-9._:-]{8,100}$/;

/**
 * Resolve the caller's correlation id.
 *
 * The BODY (`correlation_id`) is the primary carrier: a custom request header
 * requires every reachable edge function to have been redeployed with it in
 * `Access-Control-Allow-Headers` before a browser will even send the request,
 * so the client cannot rely on one. The `x-correlation-id` header is still
 * accepted for server-to-server callers (cron, edge-to-edge) that face no
 * preflight. Falls back to a fresh id so a request is never uncorrelated.
 */
export function marketCorrelationId(headers:Headers, body?:{correlation_id?:unknown}):string {
  const fromBody=typeof body?.correlation_id==='string' ? body.correlation_id.trim() : '';
  if(CORRELATION_ID_RE.test(fromBody)) return fromBody;
  const fromHeader=headers.get('x-correlation-id')?.trim();
  return fromHeader && CORRELATION_ID_RE.test(fromHeader) ? fromHeader : crypto.randomUUID();
}

export function classifyMarketError(error:unknown, status?:number):MarketErrorCode {
  const message=String((error as any)?.code ?? (error as any)?.message ?? error ?? '').toLowerCase();
  const attempts=Array.isArray((error as any)?.attempts)?(error as any).attempts:[];
  const lastAttempt=attempts[attempts.length-1];
  const http=Number(status ?? (error as any)?.status ?? lastAttempt?.status ?? 0);
  const providerHttp=Number(lastAttempt?.status ?? http);
  const attemptError=String(lastAttempt?.error ?? '').toLowerCase();
  if(providerHttp===401) return 'provider_unauthorised';
  if(providerHttp===402) return 'provider_payment_required';
  if(providerHttp===403) return 'provider_unauthorised';
  if(http===401) return 'session_expired';
  if(http===403) return 'rls_denied';
  if(http===404) return 'function_missing';
  if(providerHttp===429) return 'provider_rate_limited';
  if(message.includes('timeout')||message.includes('deadline')||attemptError.includes('timeout')||http===408||http===504) return 'provider_timeout';
  if(message.includes('not configured')||message.includes('assignment')||attemptError.includes('not_configured')) return 'provider_not_configured';
  if(message.includes('does not exist')||message.includes('schema cache')||message.includes('42p01')) return 'migration_missing';
  if(message.includes('parse')) return 'source_parse_failed';
  if(message.includes('validation')) return 'source_validation_failed';
  if(message.includes('source_fetch')||message.includes('fetch failed')) return 'source_fetch_failed';
  if(message.includes('insert')) return 'database_insert_failed';
  if(message.includes('digest')) return 'digest_failed';
  if(message.includes('cron_stale')) return 'cron_stale';
  if(message.includes('cron')) return 'cron_missing';
  return 'unknown';
}

export function logMarketEvent(level:'info'|'warn'|'error',event:{function:string;stage:string;correlation_id:string;status:string;duration_ms?:number;run_id?:string|null;source_id?:string|null;route?:string|null;model_id?:string|null;retry_attempt?:number;http_status?:number;error_class?:MarketErrorCode;[key:string]:unknown}) {
  const safe=JSON.stringify(event);
  if(level==='error') console.error(safe); else if(level==='warn') console.warn(safe); else console.info(safe);
}
