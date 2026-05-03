# Unit Test Cases (UT)

## Scope

Unit-level validation for core business logic derived from:
- Functional design
- Detailed design
- SCR screen specs
- V2 change-request addenda (full-stack + Guest/Host/Admin RBAC + PostgreSQL)

## Test Data Notes

- Property ID samples: `sachi-ojima`, `sachi-shinjuku`
- User roles: `GUEST`, `HOST`, `ADMIN`
- Host assignment sample: `host_001 -> sachi-ojima`

## UT Matrix

| TC ID | Module | Objective | Preconditions | Steps | Expected Result | Priority |
|---|---|---|---|---|---|---|
| UT-001 | pricing.calculateNights | Validate night count from check-in/out | Valid date range | 1. Input 2026-06-01 to 2026-06-04 | Nights = 3 | High |
| UT-002 | pricing.calculateNights | Reject same-day booking | Same check-in and check-out | 1. Input 2026-06-01 to 2026-06-01 | Validation error returned | High |
| UT-003 | pricing.getRateByGuests | Get correct rate tier | Rate tiers configured | 1. Request tier for 2 guests | Returns tier for 2 guests | High |
| UT-004 | pricing.getRateByGuests | Reject unsupported guest count | Max tier = 8 guests | 1. Request tier for 10 guests | Error: max guest exceeded | High |
| UT-005 | pricing.getChildPrice | Apply child discount correctly | childDiscountPercent configured | 1. Input adult rate and child count | Child unit price discounted and rounded per rule | High |
| UT-006 | pricing.getCleaningFee | Select proper cleaning tier | Cleaning tiers configured | 1. Input payingGuests = 4 | Correct cleaning fee returned | High |
| UT-007 | pricing.calculateTotal | Compute total quote breakdown | Valid dates, guest counts, tiers | 1. Run full pricing calc | Total = subtotal + cleaning with deterministic values | High |
| UT-008 | booking.validation | Enforce paying guest max | Pricing max guest defined | 1. Enter adults+children over max | Validation error shown | High |
| UT-009 | booking.validation | Ignore infants in paying guests | Infants included | 1. adults=2, children=1, infants=2 | Paying guests = 3 | High |
| UT-010 | booking.mailtoBuilder | Encode subject/body safely | Valid inquiry fields | 1. Generate mailto string | URL encoded; no header injection characters break URI | High |
| UT-011 | auth.roleResolver | Resolve role from JWT claims | JWT has role claim | 1. Parse token | Returns ADMIN/HOST/GUEST correctly | High |
| UT-012 | auth.permission | Admin can manage all properties | Role ADMIN | 1. authorize(update, propertyX) | Authorized | High |
| UT-013 | auth.permission | Host limited to assigned properties | Role HOST assigned to propertyA only | 1. authorize(update, propertyB) | Forbidden | High |
| UT-014 | auth.permission | Guest cannot write | Role GUEST | 1. authorize(createProperty, any) | Forbidden | High |
| UT-015 | assignment.validation | Prevent duplicate host assignment | Assignment already exists | 1. assign host_001 to sachi-ojima again | Duplicate assignment error | Medium |
| UT-016 | assignment.validation | Allow assignment removal | Existing assignment | 1. unassign host_001 from sachi-ojima | Assignment removed successfully | Medium |
| UT-017 | property.slugValidator | Validate metalink format | Candidate string provided | 1. input invalid chars `abc/??` | Validation failed | High |
| UT-018 | property.slugValidator | Normalize valid slug | Candidate `Sachi_Ojima-01` | 1. validate and normalize | Accepted normalized slug | Medium |
| UT-019 | blog.validation | Require mandatory blog fields | Missing title/content | 1. validate post input | Validation error with field details | High |
| UT-020 | blog.permission | Host author policy check | Host policy disabled | 1. host create blog | Forbidden | Medium |
| UT-021 | blog.permission | Admin always publish allowed | Role ADMIN | 1. publish draft | Success | High |
| UT-022 | access.validation | Validate map and video links | URL input provided | 1. parse and validate URL | Accept valid URL; reject malformed | Medium |
| UT-023 | manual.searchFilter | Filter manual items by keyword | Manual list seeded | 1. search term `wifi` | Matching items returned only | Medium |
| UT-024 | rules.renderModel | Preserve line breaks in notes | Additional notes text has new lines | 1. transform for display | Line breaks preserved | Low |
| UT-025 | iCal.parser | Parse ICS blocked dates | Valid ICS sample | 1. parse VEVENT ranges | Date blocks normalized correctly | High |
| UT-026 | iCal.parser | Ignore malformed events | ICS contains bad event | 1. parse feed | Bad event skipped; parser continues | Medium |
| UT-027 | cache.keyBuilder | Build deterministic cache key | propertyId input | 1. create key for sachi-ojima | Key matches naming convention | Low |
| UT-028 | cache.invalidator | Invalidate related keys after save | Property save success event | 1. trigger invalidation | Property and list cache invalidated | Medium |
| UT-029 | api.errorMapper | Map DB duplicate violation | DB unique conflict error | 1. map exception | Returns 409 conflict payload | High |
| UT-030 | audit.logFormatter | Build immutable audit record | write action context | 1. format audit event | actor/action/target/timestamp present | High |

## Exit Criteria

- 100% pass for all High-priority unit tests
- At least 95% pass overall before integration testing phase
- Any failed High-priority case blocks release candidate
