# Security Remediation Quick Checklist

## Stage 1: Critical Fixes (Week 1) ✅

### Edge Functions
- [ ] Enable JWT on `get-client-data`
- [ ] Enable JWT on `secure-storage`
- [ ] Enable JWT on `manage-client-data`
- [ ] Enable JWT on `get-investment-reports`
- [ ] Enable JWT on `manage-investment-reports`
- [ ] Enable JWT on `get-call-logs`
- [ ] Enable JWT on `manage-call-logs`
- [ ] Enable JWT on `get-activity-logs`
- [ ] Enable JWT on `admin-user-management`
- [ ] Enable JWT on `admin-password-reset`

### RLS Policies
- [ ] Fix `client_files` policies
- [ ] Fix `client_notes` policies
- [ ] Fix `client_activities` policies
- [ ] Fix `client_tags` policies
- [ ] Fix `client_tag_assignments` policies
- [ ] Fix `client_income` policies
- [ ] Fix `client_assets` policies
- [ ] Fix `client_liabilities` policies
- [ ] Fix `client_expenses` policies
- [ ] Fix `borrowing_capacity_assessments` policies

### Configuration
- [ ] Enable leaked password protection

**Stage 1 Complete When:** All checkboxes above are checked

---

## Stage 2: High Priority (Weeks 2-4) ✅

### Edge Functions Audit
- [ ] Audit all 80 edge functions
- [ ] Categorize functions (public/authenticated/admin)
- [ ] Enable JWT on authenticated functions
- [ ] Add role checks to admin functions
- [ ] Document authentication requirements

### Email & Communication
- [ ] Fix `email_copilot_emails` policies
- [ ] Fix `email_copilot_sent_replies` policies
- [ ] Fix `vapi_call_logs` policies (if needed)

### Reports & Analysis
- [ ] Fix `investment_reports` policies
- [ ] Fix `property_comparisons` policies
- [ ] Fix `cash_flow_analyses` policies
- [ ] Fix `portfolio_reviews` policies
- [ ] Fix `portfolio_analysis_reports` policies

### Extensions
- [ ] Create extensions schema
- [ ] Move `vector` extension
- [ ] Move `pg_net` extension
- [ ] Test extension functionality

**Stage 2 Complete When:** All checkboxes above are checked

---

## Stage 3: Medium Priority (Weeks 5-8) ✅

### Database
- [ ] Review Postgres upgrade requirements
- [ ] Create backup before upgrade
- [ ] Upgrade Postgres version
- [ ] Test post-upgrade functionality

### RBAC
- [ ] Create `is_admin()` function
- [ ] Create `owns_client()` function
- [ ] Update policies to use RBAC functions
- [ ] Test RBAC functionality

### Automation
- [ ] Fix `auto_report_switches` policies
- [ ] Fix `global_report_settings` policies
- [ ] Fix `auto_report_master_settings` policies

### Audit Logging
- [ ] Create `security_audit_log` table
- [ ] Create audit trigger function
- [ ] Apply triggers to sensitive tables
- [ ] Test audit logging

**Stage 3 Complete When:** All checkboxes above are checked

---

## Stage 4: Long-term (Weeks 9-12+) ✅

### Rate Limiting
- [ ] Implement rate limiting middleware
- [ ] Apply to login endpoints
- [ ] Apply to report generation
- [ ] Apply to data exports

### CORS
- [ ] Audit current CORS settings
- [ ] Remove wildcard patterns
- [ ] Tighten allowed origins
- [ ] Test CORS configuration

### Encryption
- [ ] Verify database encryption
- [ ] Verify backup encryption
- [ ] Implement field-level encryption (if needed)

### Monitoring
- [ ] Set up security alerts
- [ ] Create monitoring dashboard
- [ ] Configure anomaly detection

**Stage 4 Complete When:** All checkboxes above are checked

---

## Testing Checklist

### Before Each Stage
- [ ] Test in staging environment
- [ ] Review migration scripts
- [ ] Backup production database
- [ ] Notify team of changes

### After Each Stage
- [ ] Verify functionality works
- [ ] Test authentication flows
- [ ] Test authorization boundaries
- [ ] Run security tests
- [ ] Update documentation

---

## Rollback Checklist

### If Issues Occur
- [ ] Stop deployment immediately
- [ ] Assess impact
- [ ] Execute rollback plan
- [ ] Restore from backup if needed
- [ ] Document issue and resolution
- [ ] Revise plan before retry

---

## Final Verification

### Security Score
- [ ] Stage 1: Score improved to 55+
- [ ] Stage 2: Score improved to 70+
- [ ] Stage 3: Score improved to 80+
- [ ] Stage 4: Score improved to 85+

### Security Tests
- [ ] Penetration testing passed
- [ ] Access control verified
- [ ] Authentication working
- [ ] No unauthorized access possible

### Documentation
- [ ] All changes documented
- [ ] Migration scripts saved
- [ ] Rollback procedures documented
- [ ] Team trained on new security measures

---

**Last Updated:** [Date]  
**Status:** [In Progress / Complete]

