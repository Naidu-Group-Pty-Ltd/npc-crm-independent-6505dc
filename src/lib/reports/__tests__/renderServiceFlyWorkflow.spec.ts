/**
 * The Fly.io route for the render container keeps four promises.
 *
 * It was written on 15 Sep 2026 so that full functionality did not depend on
 * Google Cloud Run — the owner declined to deploy there again on cost
 * grounds — and it is only safe if: it does nothing without BOTH credentials
 * (a half-configured run would mint a token nobody can retrieve); the token
 * is masked and never reaches the summary; there is one machine, so the bill
 * is bounded by that machine; and the URL and the token reach Supabase in one
 * call, because writing them separately is how the two sides drift.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..', '..');
const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'deploy-render-fly.yml'), 'utf8');
const flyToml = readFileSync(join(ROOT, 'weasyprint-service', 'fly.toml'), 'utf8');

describe('deploy-render-fly.yml', () => {
  it('does nothing without both credentials', () => {
    expect(workflow).toMatch(/\[ -n "\$\{FLY:-\}" \]\s+\|\| missing="\$missing FLY_API_TOKEN"/);
    expect(workflow).toMatch(/\[ -n "\$\{SUPA:-\}" \] \|\| missing="\$missing SUPABASE_ACCESS_TOKEN"/);
    expect(workflow).toMatch(/if \[ -n "\$missing" \]; then[\s\S]*?exit 1/);
  });

  it('mints the token on the runner, masks it, and never writes it to the summary', () => {
    expect(workflow).toMatch(/value=\$\(openssl rand -hex 32\)\s*\n\s*echo "::add-mask::\$value"/);
    const summary = /Say what is live[\s\S]*$/.exec(workflow)![0];
    expect(summary).not.toMatch(/steps\.token/);
    expect(summary).not.toMatch(/\$TOKEN/);
  });

  it('runs one machine — the bill is bounded by it', () => {
    // The command spans continuation lines; the flag is what matters.
    expect(workflow).toMatch(/flyctl deploy --app "\$APP"[\s\S]*?--ha=false/);
    expect(flyToml).toMatch(/min_machines_running = 0/);
    expect(flyToml).toMatch(/auto_stop_machines = "stop"/);
    expect((flyToml.match(/\[\[vm\]\]/g) ?? []).length).toBe(1);
  });

  it('builds from the service directory, as CI and Cloud Build do', () => {
    // flyctl uploads the directory it runs in. Run from the repository root,
    // the first dispatch shipped the whole repository (541 MB, 8,342 files)
    // and the Dockerfile's relative COPYs found nothing.
    const step = /- name: Build and deploy\n([\s\S]*?)\n\s+- name:/.exec(workflow)![1];
    expect(step).toMatch(/working-directory: weasyprint-service/);
    expect(step).toMatch(/--config fly\.toml --dockerfile Dockerfile/);
    expect(step).not.toMatch(/weasyprint-service\/(fly\.toml|Dockerfile)/);
  });

  it('proves the container before pointing the edge functions at it, and writes both names in one call', () => {
    const proof = workflow.indexOf('The container renders that report whole');
    const repoint = workflow.indexOf('Point the edge functions at the container');
    expect(proof).toBeGreaterThan(0);
    expect(repoint).toBeGreaterThan(proof);
    expect(workflow).toMatch(/supabase secrets set --project-ref "\$PROJECT_REF" \\\n\s+"WEASYPRINT_SERVICE_URL=\$url" "WEASYPRINT_SERVICE_TOKEN=\$TOKEN"/);
  });

  it('serves the container on the port the Dockerfile listens on', () => {
    expect(flyToml).toMatch(/internal_port = 8080/);
    expect(readFileSync(join(ROOT, 'weasyprint-service', 'Dockerfile'), 'utf8')).toMatch(/EXPOSE 8080/);
  });
});
