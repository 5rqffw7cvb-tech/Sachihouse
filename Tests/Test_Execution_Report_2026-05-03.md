# Test Execution Report (2026-05-03)

## Implemented Stack

- Frontend: React/Vite app in `Old_SoruceCode/`
- Backend: Node.js + TypeScript API in `backend/`
- Database: PostgreSQL via Docker Compose
- Runtime: `docker compose up --build -d`

## Unit Test Results

Command:
- `cd backend && npm test`

Result:
- Passed: 14/14 tests
- Scope covered:
  - Pricing domain rules
  - Authorization and role-based permission rules
  - Backend API integration scenarios via supertest

## Executed Integration Coverage

Automated integration tests passed for:
- IT-001: Auth login and role profile
- IT-004: Property list API
- IT-006: Host update on assigned property
- IT-007: Host blocked on non-assigned property
- IT-009: Admin host assignment API
- IT-017: Quote API calculation

## Executed System Coverage

Validated against the deployed Docker stack at:
- Frontend: `http://localhost:8080`
- API: `http://localhost:3001/api`

System checks completed successfully for:
- ST-001: Guest views listings and property detail
- ST-002: Guest navigates property pages
- ST-003: Guest pricing widget shows valid quote output
- ST-006: Guest reads blog list and blog post detail
- ST-007: Host edits assigned property and change is visible on public page
- ST-008: Host save on non-assigned property is rejected with clear error
- ST-017: Direct admin route requires authentication
- ST-019: Persistence and reload consistency for saved property updates

Additional deployed behavior confirmed:
- Admin-only property actions on listings page
- Admin host assignment toggle on listings page

## Executed Non-Functional Smoke Coverage

Local non-functional checks passed for:
- NFC-001 / NFC-002: API latency smoke
  - Observed local p95 for `GET /api/properties`: `0.004s`
- NFC-005: Concurrent guest-read smoke
  - 20/20 concurrent requests returned `200`
- NFC-010 / NFC-011: RBAC enforcement smoke
  - Confirmed by integration and system test behavior
- NFC-015: Security header exposure
  - `Content-Security-Policy`
  - `Cross-Origin-Opener-Policy`
  - `X-Content-Type-Options`
  - `X-Frame-Options`
- Availability smoke
  - Docker services healthy for `db`, `api`, `web`

## Notes

- Some NFR cases in the document require infrastructure outside a local workstation to prove fully, such as multi-AZ failover, backup/restore drills, and cross-browser matrix testing.
- Local executable subsets were implemented and passed in this environment.
