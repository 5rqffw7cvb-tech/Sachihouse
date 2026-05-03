# System Test Cases (ST)

## Scope

End-to-end behavior validation across full system for:
- Public guest journeys
- Admin operations
- Host operations on assigned properties
- Multi-property and blog workflows

## ST Matrix

| TC ID | Scenario | Preconditions | Steps | Expected Result | Priority |
|---|---|---|---|---|---|
| ST-001 | Guest views listings and property detail | At least 1 published property | 1. Open / 2. Open property card | Listing and property detail render correctly | High |
| ST-002 | Guest navigates all property pages | Property has full content | 1. Home 2. Access 3. Pricing 4. Rules 5. Manual 6. Photos | All pages load and content is consistent | High |
| ST-003 | Guest uses booking widget valid flow | Pricing data configured | 1. Pick dates 2. Set guests 3. Review quote | Price breakdown shown and correct | High |
| ST-004 | Guest booking inquiry launch | Email client available | 1. Click Send Booking Inquiry | Mail client opens with prefilled encoded message | Medium |
| ST-005 | Guest blocked date visibility | Availability contains blocked dates | 1. Open pricing calendar | Blocked dates shown unavailable | High |
| ST-006 | Guest reads blog list and post | Posts published | 1. Open /blog 2. Open one post | Blog list and markdown post render properly | Medium |
| ST-007 | Host login and assigned property edit | Host assigned to propertyA | 1. Login as host 2. Open propertyA admin 3. Edit and save | Save succeeds; updates visible on public page | High |
| ST-008 | Host denied non-assigned property edit | Host not assigned to propertyB | 1. Login as host 2. Access propertyB admin | Access denied or save denied with clear message | High |
| ST-009 | Admin creates new property | Admin login | 1. Login as admin 2. Create property 3. Publish key content | New property appears in listings and detail route works | High |
| ST-010 | Admin assigns host to property | Admin + host account exists | 1. Open assignment management 2. Assign host to property | Assignment saved and host gains access | High |
| ST-011 | Admin revokes host assignment | Existing assignment | 1. Revoke assignment | Host access to that property removed immediately | High |
| ST-012 | Admin edits pricing and validates FE behavior | Admin login | 1. Update pricing tiers 2. Open public pricing page | New tiers reflected in rate table and widget | High |
| ST-013 | Admin manages manual/rules/access content | Admin login | 1. Update each section 2. Refresh guest pages | Updated content appears correctly | High |
| ST-014 | Admin manages photo gallery | Admin login + storage configured | 1. Add/reorder/remove images | Gallery updates reflected in home/photos pages | Medium |
| ST-015 | Admin blog create/edit/delete lifecycle | Admin login | 1. Create post 2. Edit 3. Delete | Changes reflected in /blog and post detail | High |
| ST-016 | Host blog authoring policy | Host login + policy enabled | 1. Create/edit own post | Allowed only by policy; ownership restrictions enforced | Medium |
| ST-017 | Unauthorized direct URL access | Guest user | 1. Access admin routes directly | Redirect/deny access; no privileged data exposed | High |
| ST-018 | Concurrent update conflict handling | Two editors for same property | 1. User A edits 2. User B edits stale version 3. Save both | Conflict detected and handled without silent overwrite | Medium |
| ST-019 | Persistence and reload consistency | Completed updates exist | 1. Save content 2. Hard refresh 3. Reopen page | Data remains consistent after reload | High |
| ST-020 | Error handling on backend outage | Simulated API downtime | 1. Open key pages 2. Attempt save | Read flow shows graceful fallback; writes show clear errors | High |

## Traceability Coverage

- Listings and page navigation: SCR-01..SCR-07
- Booking and pricing: SCR-05, SCR-08
- Blog public/admin: SCR-09..SCR-11
- Property admin and assignments: SCR-12 + V2 addendum
- Role model: Guest, Host, Admin (V2 addenda)

## Exit Criteria

- 100% pass on High-priority end-to-end tests
- No blocker or critical defects open
- Business-owner signoff on Guest, Host, Admin user journeys
