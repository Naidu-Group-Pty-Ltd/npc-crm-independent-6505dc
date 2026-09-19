/**
 * The Cloud Shell redeploy block in the runbook IS the script.
 *
 * `RENDER_SERVICE_AVAILABILITY.md` carries `scripts/render-service/redeploy.sh`
 * verbatim, so that an operator with a browser and no clone can paste it into
 * Cloud Shell. Two copies of one script is how one of them goes stale — the
 * partner-agreement generators went that way — so this pins them equal, and
 * pins the two things the script must never lose: it asks before it deploys,
 * and it never names the environment variables the service already holds
 * (a `--set-env-vars` here would wipe `WEASYPRINT_SERVICE_TOKEN`).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..', '..');
const script = readFileSync(join(ROOT, 'scripts', 'render-service', 'redeploy.sh'), 'utf8');
const runbook = readFileSync(join(ROOT, 'docs', 'reports', 'RENDER_SERVICE_AVAILABILITY.md'), 'utf8');

describe('the render-service redeploy script', () => {
  it('is carried verbatim in the runbook, for pasting into Cloud Shell', () => {
    const m = /cat > redeploy\.sh <<'REDEPLOY'\n([\s\S]*?)REDEPLOY\nbash redeploy\.sh/.exec(runbook);
    expect(m, 'the runbook has no Cloud Shell block').not.toBeNull();
    expect(m![1]).toBe(script);
  });

  it('asks before it deploys, and CONFIRM=1 is the only way past the question', () => {
    expect(script).toMatch(/if \[ "\$\{CONFIRM:-\}" != "1" \]; then\s*\n\s*read -r -p/);
  });

  it('never names the environment the service already holds', () => {
    // `gcloud run deploy` keeps existing env vars only while none are named.
    expect(script).not.toMatch(/--set-env-vars|--update-env-vars|--clear-env-vars|--remove-env-vars/);
    expect(script).toMatch(/--allow-unauthenticated --memory "\$MEMORY" --cpu 2 --concurrency 4 --timeout 600/);
  });

  it('redeploys the image the service already runs, never a new one', () => {
    expect(script).toMatch(/IMAGE=\$\(gcloud run revisions describe "\$READY_REV"/);
    expect(script).toMatch(/gcloud run deploy "\$SERVICE" --project "\$PROJECT" --image "\$IMAGE"/);
  });

  it('proves the fix by effect — the front door after, not the deploy\'s exit code', () => {
    expect(script).toMatch(/say "Front door, after"/);
    expect(script).toMatch(/"\$URL\/healthz"/);
    expect(script).toMatch(/exit 1\s*\nfi\s*$/);
  });
});
