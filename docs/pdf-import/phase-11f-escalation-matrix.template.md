# PDF Import Escalation Matrix

A template for the team's escalation matrix. Fill in on-call owners and approved
contacts locally — do not hardcode private emails or phone numbers in the repo.

## Roles

| Role | Responsibility | Examples |
|---|---|---|
| pdf_operator | Evaluate / review only | Evaluate Only |
| pdf_qa_operator | QA review / manual-review flagging | Visual QA, repair review |
| pdf_admin | Production decisions / persistence | Accept / reject / block |
| developer_admin | Technical investigation | functions, storage, logs, release gate |
| business_stakeholder | Client communication | client-safe updates |

## Escalation Matrix

| Trigger | Severity | First Responder | Escalate To | Target Response | Runbook |
|---|---|---|---|---|---|
| Critical monitoring alert | critical | pdf_admin | developer_admin | immediate | monitoring alert response |
| Sidecar unavailable | critical | developer_admin | business owner | immediate | incident response |
| Artifact bucket public | critical | pdf_admin | developer_admin / security | immediate | incident response |
| Export parity failed | high | pdf_qa_operator | pdf_admin | same day | export parity review |
| Golden gate failed/blocked | high | pdf_qa_operator | pdf_admin | same day | golden regression review |
| Permission denied | medium | requesting user | pdf_admin | same day | permission denied |
| Permission escalation detected | critical | developer_admin | security owner | immediate | permission denied / incident |
| Release gate failed | critical/high | developer_admin | pdf_admin | before deploy | release gate failure |
| Retention delete candidate | high | pdf_admin | developer_admin | weekly | retention candidate review |

## On-Call / Owner Notes

_(Fill in locally. Do not commit private contact details.)_

## Approved Contacts

_(Fill in locally. Do not hardcode private emails unless explicitly approved.)_
