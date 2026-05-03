# Non-Functional Test Cases (NFC)

## Scope

Non-functional verification for the revised full-stack architecture:
- Performance
- Scalability
- Availability and reliability
- Security
- Maintainability and observability
- Accessibility and compatibility

## NFC Matrix

| TC ID | Category | Objective | Preconditions | Steps | Expected Result | Priority |
|---|---|---|---|---|---|---|
| NFC-001 | Performance | Validate property list API latency | Staging env with realistic data | 1. Run load for GET /properties | P95 < 300 ms | High |
| NFC-002 | Performance | Validate property detail API latency | Staging with cache warm and cold | 1. Measure GET /properties/{id} | P95 target met across warm/cold profiles | High |
| NFC-003 | Performance | Validate write latency | Authenticated admin/host | 1. Execute PATCH property updates | P95 < 500 ms | High |
| NFC-004 | Performance | Validate frontend page render speed | Mobile network profile | 1. Open listing and property pages | LCP, INP, CLS within defined targets | High |
| NFC-005 | Scalability | Handle concurrent guest reads | Load test tool configured | 1. Simulate high concurrent reads | Error rate under threshold; stable latency | High |
| NFC-006 | Scalability | Handle moderate concurrent writes | Multiple host/admin writers | 1. Simulate concurrent content saves | No data corruption; acceptable write latency | High |
| NFC-007 | Reliability | API behavior during DB failover | HA environment | 1. Trigger controlled DB failover | Service recovers within RTO target | High |
| NFC-008 | Reliability | Backup and restore validation | Recent backup exists | 1. Restore to point in time | Data restored accurately within RPO/RTO | High |
| NFC-009 | Reliability | iCal worker resilience | Mixed valid/invalid feeds | 1. Run sync with failures | Partial failures isolated; service remains healthy | Medium |
| NFC-010 | Security | Enforce RBAC for write endpoints | Guest/Host/Admin test accounts | 1. Attempt writes per role matrix | Only authorized operations succeed | High |
| NFC-011 | Security | Host assignment boundary enforcement | Host assigned subset of properties | 1. Attempt cross-property modifications | Forbidden for non-assigned properties | High |
| NFC-012 | Security | JWT/session tamper resistance | Security test tooling | 1. Use altered token | Request rejected (401/403) | High |
| NFC-013 | Security | SQL injection resistance | Security scanner/manual payloads | 1. Inject payload in query params/body | No injection success; safe error response | High |
| NFC-014 | Security | XSS protection in blog/manual rendering | Malicious markdown/html payload | 1. Save/render payload | Script not executed; content sanitized | High |
| NFC-015 | Security | Sensitive data exposure check | Production-like config | 1. Inspect API errors/logs/responses | No secrets/credentials leaked | High |
| NFC-016 | Observability | Structured logging completeness | Log pipeline active | 1. Execute key journeys | Logs include traceId, actor, endpoint, status | Medium |
| NFC-017 | Observability | Metrics export correctness | Metrics endpoint enabled | 1. Generate traffic 2. Inspect metrics | RPS, latency, error metrics reflect traffic | Medium |
| NFC-018 | Observability | Audit log coverage for privileged writes | Audit persistence enabled | 1. Perform admin/host writes | Immutable audit records generated for each action | High |
| NFC-019 | Maintainability | Migration rollback readiness | Deployment pipeline with rollback | 1. Simulate failed release | Rollback completes with no data loss | Medium |
| NFC-020 | Maintainability | DB migration idempotency | Migration scripts ready | 1. Run migrations twice in clean env | No duplicate objects/invalid state | Medium |
| NFC-021 | Compatibility | Cross-browser support | Chrome/Safari/Edge/Firefox matrix | 1. Execute smoke suite | Core flows work across supported browsers | Medium |
| NFC-022 | Accessibility | Keyboard-only navigation | Accessibility tooling/manual checks | 1. Navigate major pages and forms | Focus order and operability compliant | Medium |
| NFC-023 | Accessibility | Screen reader semantics | Screen reader enabled | 1. Read nav/forms/buttons | Labels/roles announced correctly | Medium |
| NFC-024 | Privacy/Compliance | Data minimization verification | Production-like telemetry config | 1. Submit guest inquiry flow | No guest PII stored by backend unexpectedly | High |

## Pass/Fail Rules

- Any failure in High-priority NFC case is release-blocking.
- Medium-priority failures require risk acceptance and mitigation plan.
- Final signoff requires evidence artifacts: load reports, security report, backup-restore report, and accessibility checklist.
