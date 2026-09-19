import { readFileSync } from 'node:fs';
const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
const audit = readFileSync('scripts/security/dependency-audit.mjs', 'utf8');
const failures = [];
if (!/SECURITY_AUDIT_LEVEL:\s*high/.test(workflow)) failures.push('CI does not block dependency findings at high severity');
if (!/\|\| 'high'/.test(audit)) failures.push('dependency audit default is weaker than high');
if (failures.length) { console.error(`Dependency gate level FAILED:\n- ${failures.join('\n- ')}`); process.exit(1); }
console.log('Dependency gate blocks high and critical vulnerabilities.');
