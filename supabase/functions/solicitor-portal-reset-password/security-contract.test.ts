import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const functionSource = readFileSync(
  fileURLToPath(new URL('./index.ts', import.meta.url)),
  'utf8',
)
const migrationSource = readFileSync(
  fileURLToPath(new URL('../../migrations/20260730130000_atomic_solicitor_reset_attempts.sql', import.meta.url)),
  'utf8',
)

describe('solicitor portal reset attempt limiting', () => {
  it('consumes each OTP attempt through the atomic database function', () => {
    expect(functionSource).toContain("supabase.rpc('consume_solicitor_portal_reset_attempt'")
    expect(functionSource).not.toContain('reset_attempts: (user.reset_attempts || 0) + 1')
  })

  it('serializes increments and restricts token access to service_role', () => {
    expect(migrationSource).toMatch(/UPDATE solicitor_portal_users[\s\S]*SET reset_attempts = COALESCE\(reset_attempts, 0\) \+ 1/)
    expect(migrationSource).toContain("RETURN QUERY SELECT 'too_many'::text, NULL::text")
    expect(migrationSource).toMatch(/REVOKE EXECUTE[\s\S]*FROM PUBLIC, anon, authenticated/)
    expect(migrationSource).toMatch(/GRANT EXECUTE[\s\S]*TO service_role/)
  })
})
