# Builder Portal — Pilot Checklist

Run against one Aurixa-controlled organisation, in `shadow` then `cutover`. Every item is pass/fail
with evidence; a failure stops the pilot rather than being noted and carried.

---

## 1. Governance journey

- [ ] Invitation delivered to a controlled address
- [ ] Invitation accepted; password set
- [ ] **Invite reuse rejected** — the same link a second time
- [ ] Login succeeds
- [ ] Invalid login rejected with the **generic** message
- [ ] Unknown email returns the **same** message and takes comparable time (enumeration-safe)
- [ ] Suspended user, revoked user and revoked membership each rejected with the same generic message
- [ ] Session verification returns the expected organisations and permissions
- [ ] Sign-out revokes the session server-side; the old cookie is dead
- [ ] Password reset works; **reset reuse rejected**; reset attempt limiting bites
- [ ] Password change works and rotates the session
- [ ] Session revocation from settings ends that device
- [ ] Organisation selection offers **only** organisations at `cutover`
- [ ] Terms wall blocks until accepted
- [ ] **A new terms version re-gates an already-accepted user**
- [ ] Mandatory onboarding blocks until completed
- [ ] CSRF rejection on a forged mutation
- [ ] Disallowed origin rejected; allowed origin succeeds

## 2. Session cookie — **R2, the highest-risk item**

Inspect `__Host-builder_session_token` in a real browser:

- [ ] `Secure`
- [ ] `HttpOnly`
- [ ] `Path=/`
- [ ] **No `Domain` attribute**
- [ ] `SameSite` value recorded, and it works for the actual application ↔ function origin pair
- [ ] Cookie survives normal permitted navigation
- [ ] **Not readable from JavaScript** (`document.cookie` does not contain it)
- [ ] **Never returned in a JSON body**
- [ ] Works on **desktop Chromium and mobile**
- [ ] Works with third-party cookies restricted — or the dependency is documented and accepted

## 3. External workflows

Dashboard · Projects · Project detail · Inventory · Unit detail · Holds · Reservations ·
Allocations · Transactions · Transaction detail · Pipeline · Transaction–case link · Construction ·
Construction detail · Milestones · Progress updates · Photographs · Variations · Progress claims ·
Inspections · Defects · Practical completion · Handover · Warranty · Documents · Upload · Download ·
Document version · Document access · Messages · Tasks · Notifications · Activity · Settings ·
Organisation settings · User preferences · Session security

- [ ] Every surface loads
- [ ] Empty, loading, error, retry and permission-denied states each render correctly
- [ ] Desktop and mobile navigation agree
- [ ] **Onboarding tour** appears on first sign-in and walks all ten destinations
- [ ] **Tour replay** from Settings → Portal help restarts it
- [ ] Tour honours reduced motion
- [ ] ⛔ **Quarantine and scan-result states cannot be tested — B1.** Record as not-tested, never as passed

## 4. Internal administration

Organisations · Users · Memberships · Permissions · Projects · Inventory · Transactions ·
Construction · Delivery · Collaboration · Workspace · **Release readiness · Controlled rollout ·
Approvals · Operational health · Rollback**

- [ ] Create, update, transition and revoke each work
- [ ] **Missing `expected_version` → 400**
- [ ] **Stale `expected_version` → 409**
- [ ] Matching `expected_version` → 200
- [ ] Read-only staff can view but not mutate
- [ ] Unauthorized staff receive 403

## 5. Release-control plane

- [ ] Portal blocked while `off`
- [ ] Admin can view readiness, with required / advisory / not-applicable distinguished
- [ ] Invalid transition rejected (`off → cutover`)
- [ ] Missing reason rejected
- [ ] Approval without evidence rejected
- [ ] All four approval types recordable
- [ ] Approval revocation works and drops readiness
- [ ] **Not-applicable legacy checks display as not applicable, with a reason** — never as passing
- [ ] Stable window enforced
- [ ] Pilot organisation enabled; **a second organisation stays blocked**
- [ ] Rollout history records every transition with its reason
- [ ] Audit history records every transition
- [ ] **Immediate rollback disables access**
- [ ] **Rollback preserves every domain record** — count before and after
- [ ] Solicitor rollout unaffected

## 6. Security isolation

- [ ] Organisation A cannot read or mutate Organisation B
- [ ] Project A access does not grant Project B; likewise Unit, Transaction, Construction Case and Delivery Record
- [ ] A document grant cannot bypass parent scope
- [ ] Conversation participation cannot bypass parent scope
- [ ] Task assignment cannot bypass parent scope
- [ ] Notification content cannot expose an inaccessible record
- [ ] Revoked membership removes access **immediately**
- [ ] Suspended organisation removes access **immediately**
- [ ] An explicit allow cannot restore revoked access
- [ ] Direct database access blocked (anon and authenticated)
- [ ] Direct storage access blocked
- [ ] Signed URL requires current permission; an expired signed URL fails
- [ ] ⛔ **Unsafe document cannot be downloaded — untestable, B1.** Record as not-tested
- [ ] Portal activity hides administrative audit detail
- [ ] Absent from every surface: client-private, Finance-private, Solicitor-private, AML/CTF,
      commission, and Builder-private commercial data

## 7. Exit criteria

- [ ] Every item above passed, or is explicitly recorded as not-tested with a reason
- [ ] No open critical Builder alert
- [ ] Minimum stable window completed
- [ ] Rollback rehearsed end-to-end
- [ ] All four approvals active with evidence
- [ ] Support briefed and on call
