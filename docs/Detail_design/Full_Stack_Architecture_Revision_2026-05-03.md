# Full-Stack Architecture Revision (2026-05-03)

## 1. Objective

Upgrade SachiHouse78 from frontend + Firebase data access to a full-stack platform with explicit backend services, relational data modeling, and role-based authorization for Guest, Host, and Admin.

## 2. Recommended Technology Baseline

- Frontend: React + TypeScript (existing UI retained, API client refactor)
- Backend: Node.js + TypeScript (NestJS recommended)
- Database: PostgreSQL 16 (recommended managed service)
- Cache: Redis
- Object Storage: S3-compatible storage
- Async Processing: Queue worker for iCal sync and delayed jobs

## 3. Why PostgreSQL (DB Recommendation)

PostgreSQL is recommended as the replacement for Firebase Firestore because it provides:

- Strong transactional consistency for multi-entity writes.
- Better query tuning and indexing for predictable performance.
- First-class support for relational authorization data (user-role-property assignment).
- Mature backup, replication, and operational tooling.

## 4. High-Level Components

- Web App (Guest/Host/Admin UI)
- API Gateway / Backend Service
- Auth Service (JWT/session + refresh)
- Property Service
- Blog Service
- Assignment Service
- Availability Service (iCal ingestion + normalized calendar)
- PostgreSQL
- Redis
- Object Storage
- Background Worker

## 5. Role Model and Permissions

- Guest:
  - Public read access.
  - No authenticated write operations.
- Host:
  - Can manage only properties assigned by Admin.
  - Can update content/pricing/media/availability sources on assigned properties.
- Admin:
  - Full control of all resources.
  - Manages user roles and host-property assignments.

## 6. Core Relational Schema (Minimum)

- users (id, email, status, created_at)
- roles (id, code: ADMIN/HOST)
- user_roles (user_id, role_id)
- properties (id, metalink, title, status, owner_user_id, updated_at)
- host_property_assignments (host_user_id, property_id, assigned_by, assigned_at)
- blog_posts (id, title, slug, content_md, author_user_id, published_at)
- property_availability_blocks (property_id, date, source, status)
- audit_logs (id, actor_user_id, action, target_type, target_id, diff_json, created_at)

## 7. API Surface (Illustrative)

- Auth:
  - POST /api/v1/auth/login
  - POST /api/v1/auth/refresh
  - POST /api/v1/auth/logout
  - GET /api/v1/auth/me
- Properties:
  - GET /api/v1/properties
  - GET /api/v1/properties/{id}
  - POST /api/v1/properties
  - PATCH /api/v1/properties/{id}
  - DELETE /api/v1/properties/{id}
- Assignments:
  - POST /api/v1/properties/{id}/hosts/{hostUserId}
  - DELETE /api/v1/properties/{id}/hosts/{hostUserId}
- Blog:
  - GET /api/v1/blog
  - GET /api/v1/blog/{id}
  - POST /api/v1/blog
  - PATCH /api/v1/blog/{id}
  - DELETE /api/v1/blog/{id}

## 8. Migration Strategy

- Phase 1: Build backend + PostgreSQL schema + API contracts.
- Phase 2: Add API client layer to frontend, keep UI unchanged.
- Phase 3: Perform Firestore -> PostgreSQL data migration (ETL + reconciliation).
- Phase 4: Enable dual-read verification window and monitor parity.
- Phase 5: Cutover writes to PostgreSQL, remove Firebase write paths.
- Phase 6: Retire Firebase dependencies after stabilization.

## 9. Non-Functional Targets

- P95 read endpoint latency < 300 ms
- P95 write endpoint latency < 500 ms
- Audit logging for all privileged writes
- Daily backup + point-in-time restore enabled
- Structured logs + distributed tracing for API and DB calls

## 10. Risks and Mitigations

- Migration risk:
  - Mitigation: data reconciliation checksums and rollback plan.
- Authorization regression risk:
  - Mitigation: policy tests for Guest/Host/Admin matrices.
- Query performance risk:
  - Mitigation: index review, slow-query logging, and load tests.
