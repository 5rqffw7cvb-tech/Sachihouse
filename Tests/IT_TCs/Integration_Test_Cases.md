# Integration Test Cases (IT)

## Scope

Integration tests covering interfaces between:
- Frontend and backend APIs
- Backend services and PostgreSQL
- Auth and RBAC middleware
- Background iCal sync and availability read model

## Environments

- IT-ENV-01: local docker or dev stack
- IT-ENV-02: staging-like environment with production-equivalent schema

## IT Matrix

| TC ID | Integration Path | Objective | Preconditions | Steps | Expected Result | Priority |
|---|---|---|---|---|---|---|
| IT-001 | FE -> Auth API | User login creates valid session/token | Valid Admin credentials | 1. Call login endpoint 2. Fetch profile | Token/session issued; role=ADMIN in profile | High |
| IT-002 | FE -> Auth API | Host login resolves host role | Valid Host credentials | 1. Login 2. Call /auth/me | role=HOST returned | High |
| IT-003 | FE -> Auth API | Guest has no privileged session | Anonymous user | 1. Call protected endpoint | 401/403 returned | High |
| IT-004 | FE -> Property API -> DB | Load listing page from API + DB | DB has 2+ properties | 1. GET /properties | API returns paginated list with expected fields | High |
| IT-005 | FE -> Property API -> DB | Fetch property detail by id | Existing property | 1. GET /properties/{id} | Correct property payload returned | High |
| IT-006 | FE -> Property API -> RBAC -> DB | Host edits assigned property | Host assigned to propertyA | 1. PATCH propertyA | 200 success; DB row updated | High |
| IT-007 | FE -> Property API -> RBAC -> DB | Host blocked from non-assigned property | Host assigned only propertyA | 1. PATCH propertyB | 403 forbidden; no DB update | High |
| IT-008 | FE -> Property API -> RBAC -> DB | Admin edits any property | Admin logged in | 1. PATCH propertyB | 200 success | High |
| IT-009 | FE -> Assignment API -> DB | Admin assigns host to property | Admin + existing host/property | 1. POST assignment | Assignment row inserted | High |
| IT-010 | FE -> Assignment API -> DB | Admin unassigns host | Existing assignment | 1. DELETE assignment | Assignment removed | High |
| IT-011 | FE -> Assignment API -> DB | Prevent duplicate assignment | Assignment exists | 1. POST same assignment | 409 conflict | Medium |
| IT-012 | FE -> Property API -> DB constraint | Enforce unique metalink | Existing metalink in DB | 1. Create/update with duplicate metalink | 409 conflict with validation message | High |
| IT-013 | FE -> Blog API -> DB | Create blog post as Admin | Admin logged in | 1. POST blog | Post created with author metadata | High |
| IT-014 | FE -> Blog API -> RBAC -> DB | Host blog create policy enforced | Host logged in; policy disabled | 1. POST blog | 403 forbidden | Medium |
| IT-015 | FE -> Blog API -> DB | Search blog with category and keyword | Posts seeded | 1. GET /blog?category=Tips&q=train | Filtered list returned | Medium |
| IT-016 | FE -> Pricing API -> DB | Load pricing tiers from backend | Pricing configured | 1. GET /properties/{id}/pricing | Pricing tiers and cleaning returned | High |
| IT-017 | FE -> Quote API -> Pricing service | Server-side quote consistency | Valid quote request payload | 1. POST /quotes | Total equals expected formula output | High |
| IT-018 | iCal worker -> DB -> FE API | Blocked dates synced from ICS | iCal source configured | 1. Run sync worker 2. GET availability | Date blocks persisted and exposed by API | High |
| IT-019 | iCal worker failure path | Handle malformed feed without crash | One invalid ICS source | 1. Run sync worker | Failed source logged; other sources still processed | Medium |
| IT-020 | FE -> API -> Audit log | Write actions produce audit row | Admin update operation | 1. PATCH property | Audit record inserted with actor/action/target | High |
| IT-021 | FE -> API -> Cache | Invalidate read cache after write | Cache enabled | 1. GET property 2. PATCH property 3. GET property | Second GET returns updated value, not stale | High |
| IT-022 | FE -> API Error contract | Validation error format consistency | Invalid payload | 1. Submit invalid request | Standardized error schema returned | Medium |
| IT-023 | FE -> API Security headers | API returns secure headers | Any endpoint call | 1. GET /health or /properties | Required security headers present | Medium |
| IT-024 | DB transaction path | Multi-step update is atomic | Operation updates multiple tables | 1. Force failure in step 2 | Entire transaction rolled back | High |

## Exit Criteria

- All High-priority integration tests pass
- No unresolved security or data-integrity defects
- Defect leakage to system test must be under agreed threshold
