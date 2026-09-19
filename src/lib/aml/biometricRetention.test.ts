/**
 * Biometric disposal contract tests.
 *
 * A retained facial image is the most sensitive thing in the system, and the
 * ways its disposal goes wrong are all silent: the row is deleted but the
 * storage object survives with nothing pointing at it; the pointer is cleared
 * before the object is removed, orphaning it; the destruction happens but is
 * never logged, so it cannot be evidenced under APP 11.
 *
 * These read the source rather than executing it — the edge function is Deno
 * and unrunnable here — following the same convention as
 * `amlPortalContracts.test.ts`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repo = process.cwd();
const recordsSource = readFileSync(
  join(repo, "supabase/functions/aml-records/index.ts"), "utf8");
const verificationSource = readFileSync(
  join(repo, "supabase/functions/aml-verification/index.ts"), "utf8");
const migrationSource = readFileSync(
  join(repo, "supabase/migrations/20260728160000_aml_selfhosted_verification.sql"), "utf8");

const disposeFn = recordsSource.match(
  /async function disposeBiometric\([\s\S]*?\n\}/,
)?.[0];

describe("biometrics are enumerable for disposal", () => {
  it("registers a biometric scan source against verification_checks", () => {
    const scanSources = recordsSource.match(/const SCAN_SOURCES[\s\S]*?\n\};/)?.[0];
    expect(scanSources).toBeDefined();
    expect(scanSources).toMatch(/biometric:\s*\{\s*table:\s*"verification_checks"/);
  });

  it("derives a retention trigger for every retained image at relationship end", () => {
    // Without a trigger the image has no clock: never enumerated, never
    // approved, never destroyed — it simply stays.
    expect(recordsSource).toContain('ensure("biometric"');
    expect(recordsSource).toContain('.not("biometric_storage_path", "is", null)');
  });

  it("has a retention schedule backing the entity type", () => {
    expect(migrationSource).toMatch(/INSERT INTO aml\.retention_schedules[\s\S]*'biometric'/);
    expect(migrationSource).toContain("'hard_delete'");
  });
});

describe("disposeBiometric", () => {
  it("exists and is wired into execution", () => {
    expect(disposeFn).toBeDefined();
    expect(recordsSource).toMatch(/if \(it\.entity_type === "biometric"\)[\s\S]{0,200}disposeBiometric\(/);
  });

  it("removes the storage object BEFORE clearing the pointer", () => {
    // The reverse order loses the path and orphans the image permanently.
    const removeAt = disposeFn!.indexOf('.remove([check.biometric_storage_path])');
    const clearAt = disposeFn!.indexOf("biometric_storage_path: null");
    expect(removeAt).toBeGreaterThan(-1);
    expect(clearAt).toBeGreaterThan(-1);
    expect(removeAt).toBeLessThan(clearAt);
  });

  it("aborts rather than clearing the pointer if the object will not delete", () => {
    expect(disposeFn).toMatch(/if \(rmErr\) throw new Error/);
  });

  it("clears every column that describes the image", () => {
    for (const col of ["biometric_storage_path", "biometric_kind", "biometric_captured_at"]) {
      expect(disposeFn).toContain(`${col}: null`);
    }
  });

  it("keeps the consent that authorised collection", () => {
    // Evidence of what permitted the collection, and not itself biometric
    // information — destroying it would remove the justification, not the risk.
    expect(disposeFn).not.toContain("biometric_consent_id: null");
  });

  it("does not delete the verification record itself", () => {
    // The image is what is being disposed of. The check is a compliance record
    // with its own retention clock.
    expect(disposeFn).not.toMatch(/from\("verification_checks"\)\s*\.delete\(\)/);
  });

  it("writes the destruction to the biometric access log", () => {
    expect(disposeFn).toContain('from("biometric_access_log")');
    expect(disposeFn).toContain('action: "dispose"');
  });
});

describe("biometric reads stay audited", () => {
  it("never returns the storage path to the browser", () => {
    // The path is the only way to reach the object outside the logged path.
    expect(verificationSource).toContain("const { biometric_storage_path, ...safe } = c;");
    expect(verificationSource).toContain("has_biometric: Boolean(biometric_storage_path)");
  });

  it("requires a stated reason and logs every view", () => {
    const branch = verificationSource.match(
      /case "get_biometric_url": \{[\s\S]*?\n {6}\}/,
    )?.[0];
    expect(branch).toBeDefined();
    expect(branch).toMatch(/reason\.length < 10/);
    expect(branch).toContain('from("biometric_access_log")');
    expect(branch).toContain('action: "view"');
  });

  it("issues only short-lived signed URLs", () => {
    // A long-lived URL is an unlogged copy.
    expect(verificationSource).toMatch(/createSignedUrl\(check\.biometric_storage_path, 120\)/);
  });
});
