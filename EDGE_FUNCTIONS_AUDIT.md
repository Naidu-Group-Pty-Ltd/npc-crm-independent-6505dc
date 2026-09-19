# Edge Functions Security Audit

**Date:** 2025-01-24  
**Purpose:** Comprehensive audit of all edge functions for Stage 2 security improvements

---

## Summary

- **Total Functions:** 70+
- **Functions with JWT Enabled:** 10 (from Stage 1)
- **Functions Needing Review:** 60+
- **Functions with verify_jwt = false:** 60+

---

## Function Categories

### Category 1: Public Functions (No Auth Required)
**Rationale:** Webhooks, public APIs, or functions that should be accessible without authentication

| Function Name | Current verify_jwt | Status | Notes |
|--------------|-------------------|--------|-------|
| `airtable-proxy` | false | ✅ OK | External service proxy |
| `auto-report-webhook` | false | ✅ OK | Webhook receiver |
| `outlook-email-webhook` | false | ✅ OK | Webhook receiver |
| `vapi-call-webhook` | false | ✅ OK | Webhook receiver |
| `custom-auth-login` | false | ⚠️ REVIEW | Login endpoint - may need rate limiting |
| `custom-auth-logout` | false | ⚠️ REVIEW | Logout endpoint - may need auth check |
| `custom-auth-verify` | false | ⚠️ REVIEW | Auth verification - may need auth check |

---

### Category 2: Authenticated Functions (JWT Required)
**Rationale:** Functions that access user data, generate reports, or perform user-specific operations

#### Data Access Functions (High Priority)
| Function Name | Current verify_jwt | Status | Priority |
|--------------|-------------------|--------|----------|
| `generate-investment-report` | false | 🔴 NEEDS AUTH | HIGH - Generates sensitive reports |
| `generate-bulk-reports` | false | 🔴 NEEDS AUTH | HIGH - Bulk report generation |
| `compare-investment-reports` | false | 🔴 NEEDS AUTH | HIGH - Compares sensitive data |
| `compare-cash-flow-reports` | false | 🔴 NEEDS AUTH | HIGH - Financial data |
| `generate-portfolio-analysis` | false | 🔴 NEEDS AUTH | HIGH - Portfolio analysis |
| `calculate-borrowing-capacity` | false | 🔴 NEEDS AUTH | HIGH - Financial calculations |
| `regenerate-report-qualitative` | false | 🔴 NEEDS AUTH | HIGH - Report regeneration |
| `condense-investment-report` | false | 🔴 NEEDS AUTH | MEDIUM - Report processing |
| `format-comparison-report` | false | 🔴 NEEDS AUTH | MEDIUM - Report formatting |
| `archive-old-reports` | false | 🔴 NEEDS AUTH | MEDIUM - Report management |
| `fix-report-status` | false | 🔴 NEEDS AUTH | MEDIUM - Report management |

#### Email & Communication Functions
| Function Name | Current verify_jwt | Status | Priority |
|--------------|-------------------|--------|----------|
| `email-copilot` | false | 🔴 NEEDS AUTH | HIGH - Email access |
| `send-email-reply` | false | 🔴 NEEDS AUTH | HIGH - Sends emails |
| `outlook-email-sync` | false | 🔴 NEEDS AUTH | HIGH - Email sync |
| `outlook-manage-subscription` | false | 🔴 NEEDS AUTH | HIGH - Subscription management |
| `send-call-alert-email` | false | 🔴 NEEDS AUTH | MEDIUM - Email notifications |
| `send-weekly-call-report` | false | 🔴 NEEDS AUTH | MEDIUM - Email reports |

#### Integration Functions
| Function Name | Current verify_jwt | Status | Priority |
|--------------|-------------------|--------|----------|
| `sync-client-to-ghl` | false | 🔴 NEEDS AUTH | HIGH - Client data sync |
| `import-clients-from-ghl` | false | 🔴 NEEDS AUTH | HIGH - Client import |
| `sync-notes-to-ghl` | false | 🔴 NEEDS AUTH | HIGH - Notes sync |
| `sync-ghl-pipelines` | false | 🔴 NEEDS AUTH | MEDIUM - Pipeline sync |
| `update-ghl-opportunity-stage` | false | 🔴 NEEDS AUTH | MEDIUM - Opportunity updates |

#### System & Settings Functions
| Function Name | Current verify_jwt | Status | Priority |
|--------------|-------------------|--------|----------|
| `manage-call-settings` | false | 🔴 NEEDS AUTH | HIGH - Settings management |
| `manage-automation-settings` | false | 🔴 NEEDS AUTH | HIGH - Automation config |
| `manage-data-import` | false | 🔴 NEEDS AUTH | HIGH - Data import |
| `manage-templates` | false | 🔴 NEEDS AUTH | HIGH - Template management |
| `check-integration-secrets` | false | 🔴 NEEDS AUTH | HIGH - Secret access |
| `update-integration-secret` | false | 🔴 NEEDS AUTH | HIGH - Secret updates |
| `get-system-logs` | false | 🔴 NEEDS AUTH | MEDIUM - System logs |
| `log-activity` | false | 🔴 NEEDS AUTH | MEDIUM - Activity logging |
| `user-guide-assistant` | false | 🔴 NEEDS AUTH | LOW - User assistance |

#### Data Processing Functions
| Function Name | Current verify_jwt | Status | Priority |
|--------------|-------------------|--------|----------|
| `scrape-property-listing` | false | 🔴 NEEDS AUTH | MEDIUM - Property scraping |
| `parse-property-pdf` | false | 🔴 NEEDS AUTH | MEDIUM - PDF parsing |
| `parse-template-document` | false | 🔴 NEEDS AUTH | MEDIUM - Document parsing |
| `retrieve-template-context` | false | 🔴 NEEDS AUTH | MEDIUM - Template access |
| `estimate-property-expenses` | false | 🔴 NEEDS AUTH | MEDIUM - Expense estimation |
| `clean-note-transcript` | false | 🔴 NEEDS AUTH | LOW - Text processing |
| `cleanup-stale-calls` | false | 🔴 NEEDS AUTH | LOW - Data cleanup |

#### Data Service Functions (May be Public)
| Function Name | Current verify_jwt | Status | Priority | Notes |
|--------------|-------------------|--------|----------|-------|
| `abs-data-service` | false | ⚠️ REVIEW | MEDIUM | Public data service? |
| `rba-data-service` | false | ⚠️ REVIEW | MEDIUM | Public data service? |
| `financial-calculator-service` | false | ⚠️ REVIEW | MEDIUM | May need auth for calculations |
| `location-intelligence-service` | false | ⚠️ REVIEW | MEDIUM | Public data service? |
| `investment-scoring-service` | false | ⚠️ REVIEW | MEDIUM | May need auth for scoring |
| `domain-data-service` | false | ⚠️ REVIEW | MEDIUM | Public data service? |
| `risk-assessment-service` | false | ⚠️ REVIEW | MEDIUM | May need auth for assessments |
| `abs-seifa-service` | false | ⚠️ REVIEW | LOW | Public data service? |
| `abs-employment-service` | false | ⚠️ REVIEW | LOW | Public data service? |
| `climate-data-service` | false | ⚠️ REVIEW | LOW | Public data service? |
| `crime-statistics-service` | false | ⚠️ REVIEW | LOW | Public data service? |
| `school-data-service` | false | ⚠️ REVIEW | LOW | Public data service? |
| `public-transport-service` | false | ⚠️ REVIEW | LOW | Public data service? |
| `sqm-rent-service` | false | ⚠️ REVIEW | LOW | Public data service? |
| `cdr-lending-rates-service` | false | ⚠️ REVIEW | LOW | Public data service? |

#### Chart & Analysis Functions
| Function Name | Current verify_jwt | Status | Priority |
|--------------|-------------------|--------|----------|
| `generate-chart-images` | false | 🔴 NEEDS AUTH | MEDIUM - Chart generation |
| `generate-charts-python` | false | 🔴 NEEDS AUTH | MEDIUM - Chart generation |
| `generate-chart-analysis` | false | 🔴 NEEDS AUTH | MEDIUM - Chart analysis |

#### Utility Functions
| Function Name | Current verify_jwt | Status | Priority |
|--------------|-------------------|--------|----------|
| `financial-validation-service` | false | ⚠️ REVIEW | MEDIUM | May be internal |
| `report-schema-validator` | false | ⚠️ REVIEW | MEDIUM | May be internal |
| `data-conflict-resolver` | false | ⚠️ REVIEW | MEDIUM | May be internal |
| `update-stamp-duty-rates` | false | 🔴 NEEDS AUTH | MEDIUM | Rate updates |
| `import-schools-data` | false | 🔴 NEEDS AUTH | LOW | Data import |
| `import-suburb-directory` | false | 🔴 NEEDS AUTH | LOW | Data import |
| `migrate-comparison-scores` | false | 🔴 NEEDS AUTH | LOW | Migration utility |
| `ghl-calendar` | false | 🔴 NEEDS AUTH | MEDIUM | Calendar access |
| `ghl-calendar-test` | false | 🔴 NEEDS AUTH | LOW | Test function |
| `auto-report-sync` | false | 🔴 NEEDS AUTH | MEDIUM | Auto sync |
| `report-qa` | false | 🔴 NEEDS AUTH | MEDIUM | Report QA |

---

### Category 3: Admin Functions (JWT + Role Check Required)
**Rationale:** Functions that require admin/superadmin privileges

| Function Name | Current verify_jwt | Status | Notes |
|--------------|-------------------|--------|-------|
| `admin-user-management` | ✅ true | ✅ SECURED | Already has role check |
| `admin-password-reset` | ✅ true | ✅ SECURED | Already secured |
| `check-integration-secrets` | false | 🔴 NEEDS AUTH | Should be admin-only |
| `update-integration-secret` | false | 🔴 NEEDS AUTH | Should be admin-only |
| `manage-automation-settings` | false | 🔴 NEEDS AUTH | Should be admin-only |
| `manage-data-import` | false | 🔴 NEEDS AUTH | Should be admin-only |
| `get-system-logs` | false | 🔴 NEEDS AUTH | Should be admin-only |

---

## Priority Ranking

### 🔴 CRITICAL (Do First)
1. `generate-investment-report` - Generates sensitive financial reports
2. `generate-bulk-reports` - Bulk report generation
3. `email-copilot` - Email access
4. `send-email-reply` - Sends emails
5. `sync-client-to-ghl` - Client data sync
6. `import-clients-from-ghl` - Client import
7. `manage-call-settings` - Settings management
8. `manage-automation-settings` - Automation config
9. `check-integration-secrets` - Secret access
10. `update-integration-secret` - Secret updates

### 🟡 HIGH (Do Next)
11. `compare-investment-reports` - Compares sensitive data
12. `compare-cash-flow-reports` - Financial data
13. `generate-portfolio-analysis` - Portfolio analysis
14. `calculate-borrowing-capacity` - Financial calculations
15. `outlook-email-sync` - Email sync
16. `outlook-manage-subscription` - Subscription management
17. `sync-notes-to-ghl` - Notes sync
18. `manage-templates` - Template management
19. `manage-data-import` - Data import

### 🟢 MEDIUM (Do After High Priority)
- Report processing functions
- Chart generation functions
- Data processing functions
- Integration functions

### ⚪ LOW (Review Later)
- Public data services (may not need auth)
- Utility functions
- Test functions

---

## Implementation Plan

### Phase 1: Critical Functions (Week 2)
Secure the 10 critical functions listed above.

### Phase 2: High Priority Functions (Week 3)
Secure the high priority functions.

### Phase 3: Medium Priority Functions (Week 4)
Secure medium priority functions and review public data services.

---

## Notes

- **Public Data Services:** Some functions like `abs-data-service`, `rba-data-service` may be intentionally public if they only access public government data. These need review to confirm.
- **Webhooks:** Functions like `auto-report-webhook`, `vapi-call-webhook` should remain public but may need signature verification.
- **Custom Auth Functions:** `custom-auth-login`, `custom-auth-logout`, `custom-auth-verify` need review - they may need rate limiting instead of JWT.

