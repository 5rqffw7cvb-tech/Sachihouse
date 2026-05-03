# Non-Functional Requirements — SachiHouse78

**Project:** `sachihouse-hompage`  
**Version:** 0.0.0  
**Date:** May 2, 2026  
**Document Type:** Non-Functional Requirements (NFR)

---

## Change Request Addendum (May 3, 2026)

This addendum supersedes Firebase-only assumptions and defines NFR targets for the new full-stack system.

### NFR-CR-01: Architecture Baseline

- Frontend must communicate with backend APIs over HTTPS.
- Backend must isolate business logic from delivery layer (controller-service-repository).
- Database must be PostgreSQL (primary) with transactional integrity.

### NFR-CR-02: Database and Query Performance

- P95 API read latency target: < 300 ms for common property endpoints.
- P95 API write latency target: < 500 ms for content update endpoints.
- Required indexes: property slug/metalink, host assignment mapping, blog publish date, availability date range.
- Slow-query threshold: 200 ms; slow queries must be logged with execution plan metadata.

### NFR-CR-03: RBAC and Security

- Roles are Guest, Host, Admin.
- Authorization must be enforced server-side on every write operation.
- Host requests must be validated against property assignment records.
- All privileged actions must emit immutable audit logs (actor, action, target, timestamp).

### NFR-CR-04: Availability and Reliability

- Backend and database should run in multi-AZ configuration in production.
- RPO target: <= 15 minutes.
- RTO target: <= 60 minutes.
- Daily backups with point-in-time recovery must be enabled for PostgreSQL.

### NFR-CR-05: Observability

- Structured logs for API requests, authorization failures, and DB errors.
- Metrics required: request rate, error rate, latency percentiles, DB pool saturation.
- Trace IDs must propagate from frontend request headers through backend logs.

### NFR-CR-06: Migration Constraints

- Firestore-to-PostgreSQL migration must include reconciliation checks (record count and hash validation).
- Production cutover requires dual-run verification period and rollback plan.
- Firebase write paths are to be marked deprecated and removed after cutover sign-off.

## Table of Contents

1. [Introduction](#1-introduction)
2. [NFR-01: Performance](#2-nfr-01-performance)
3. [NFR-02: Scalability](#3-nfr-02-scalability)
4. [NFR-03: Availability & Reliability](#4-nfr-03-availability--reliability)
5. [NFR-04: Security](#5-nfr-04-security)
6. [NFR-05: Maintainability](#6-nfr-05-maintainability)
7. [NFR-06: Usability](#7-nfr-06-usability)
8. [NFR-07: Accessibility](#8-nfr-07-accessibility)
9. [NFR-08: Compatibility](#9-nfr-08-compatibility)
10. [NFR-09: Internationalization & Localization](#10-nfr-09-internationalization--localization)
11. [NFR-10: SEO & Discoverability](#11-nfr-10-seo--discoverability)
12. [NFR-11: Portability & Deployability](#12-nfr-11-portability--deployability)
13. [NFR-12: Data Integrity](#13-nfr-12-data-integrity)
14. [NFR-13: Privacy & Compliance](#14-nfr-13-privacy--compliance)
15. [NFR-14: Monitoring & Observability](#15-nfr-14-monitoring--observability)
16. [NFR Summary Table](#16-nfr-summary-table)

---

## 1. Introduction

### 1.1 Purpose

This document defines the **Non-Functional Requirements (NFRs)** for the SachiHouse78 vacation rental management web application. While functional requirements define *what* the system does, NFRs define *how well* the system does it — covering quality attributes such as performance, security, usability, and maintainability.

### 1.2 Scope

These requirements apply to all components of the system:
- The guest-facing public website.
- The admin content management interface.
- The Firebase backend (Firestore database + Authentication).
- The iCal synchronization subsystem.

### 1.3 Definitions

| Term | Definition |
|------|-----------|
| **LCP** | Largest Contentful Paint — the time until the largest visible element is rendered |
| **FID** | First Input Delay — time from first user interaction to browser response |
| **CLS** | Cumulative Layout Shift — measure of unexpected layout shifts during page load |
| **TTI** | Time to Interactive — time until the page is fully interactive |
| **SPA** | Single Page Application |
| **CDN** | Content Delivery Network |
| **CORS** | Cross-Origin Resource Sharing |
| **CSP** | Content Security Policy |

---

## 2. NFR-01: Performance

### 2.1 Overview

The application must deliver a fast, responsive experience for guests browsing on mobile devices, including those with slower network connections common in Japan (3G/4G mobile networks).

### 2.2 Page Load Performance

| Metric | Target (First Visit) | Target (Cached Visit) | Priority |
|--------|---------------------|----------------------|----------|
| **LCP** (Largest Contentful Paint) | < 2.5 s | < 1.0 s | High |
| **FID** / **INP** (Interaction to Next Paint) | < 200 ms | < 200 ms | High |
| **CLS** (Cumulative Layout Shift) | < 0.1 | < 0.1 | Medium |
| **TTI** (Time to Interactive) | < 3.5 s | < 1.5 s | High |
| **Total JS Bundle (initial)** | < 200 KB (gzipped) | — | High |

### 2.3 Caching Strategy Requirements

| Requirement | Detail |
|-------------|--------|
| **NFR-01-C1** | Property data must be served from `localStorage` cache on repeat visits, so content appears without waiting for a Firestore response. |
| **NFR-01-C2** | The cache-first pattern must be applied for both single-property (`cache_property_{id}`) and multi-property listing (`cache_properties`) data. |
| **NFR-01-C3** | Admin saves must immediately invalidate and refresh the relevant cache entries, ensuring the admin always sees up-to-date data. |
| **NFR-01-C4** | Firebase Authentication `onAuthStateChanged` initialization is intentionally delayed by 2 seconds to avoid blocking the initial render (LCP protection). |

### 2.4 Code Splitting Requirements

| Requirement | Detail |
|-------------|--------|
| **NFR-01-S1** | All page-level components (`HomePage`, `PricingPage`, `AdminPage`, etc.) must be loaded via `React.lazy` + `Suspense` to keep the initial bundle minimal. |
| **NFR-01-S2** | The Firebase SDK (Firestore, Auth) must be dynamically imported (`import()`) on first use, not included in the initial bundle. |
| **NFR-01-S3** | Build output must produce code-split chunks per route so only the required code is downloaded per navigation. |

### 2.5 Image Performance

| Requirement | Detail |
|-------------|--------|
| **NFR-01-I1** | Gallery images must use the `loading="lazy"` HTML attribute to defer off-screen image loading. |
| **NFR-01-I2** | Hero images (above the fold) must load eagerly (`loading="eager"`) to avoid LCP penalty. |
| **NFR-01-I3** | Images must specify `width` and `height` attributes or CSS `aspect-ratio` to prevent CLS. |

### 2.6 iCal Sync Performance

| Requirement | Detail |
|-------------|--------|
| **NFR-01-IC1** | iCal feed fetching must be non-blocking — it runs in the background after property data loads and does not delay the initial page render. |
| **NFR-01-IC2** | A concurrency guard must prevent multiple simultaneous iCal sync operations. |
| **NFR-01-IC3** | Each proxy attempt must have a reasonable timeout to avoid hanging the sync indefinitely (target: 5 seconds per attempt). |

---

## 3. NFR-02: Scalability

### 3.1 Overview

While the system currently manages a small number of properties, it must be designed to scale as the property portfolio grows.

### 3.2 Data Scalability

| Requirement | Detail |
|-------------|--------|
| **NFR-02-D1** | The multi-property architecture must support adding new properties without code changes — all properties share the same data schema and routing pattern (`/{id}/`). |
| **NFR-02-D2** | Blog posts must be stored individually as Firestore documents to support arbitrarily large post counts without impacting load performance for any single post. |
| **NFR-02-D3** | The listings page must support pagination or lazy loading when the property count exceeds a manageable display limit (target threshold: > 20 properties). |

### 3.3 Infrastructure Scalability

| Requirement | Detail |
|-------------|--------|
| **NFR-02-I1** | The application must have no server-side components that require scaling — all compute is client-side (browser) or handled by Firebase (Google Cloud). |
| **NFR-02-I2** | Firebase Firestore handles read scalability automatically via its distributed architecture; no additional caching layer (e.g., Redis) is required. |
| **NFR-02-I3** | The static build output must be deployable to a CDN for global distribution without modification. |

### 3.4 Concurrent Users

| Requirement | Detail |
|-------------|--------|
| **NFR-02-U1** | The architecture must support an unlimited number of concurrent guest readers — Firestore real-time reads scale automatically and there is no application server bottleneck. |
| **NFR-02-U2** | Admin writes are low-frequency (one authorized admin user); no write concurrency mechanism is required. |

---

## 4. NFR-03: Availability & Reliability

### 4.1 Overview

The application must remain usable even when backend services experience downtime.

### 4.2 Availability Targets

| Component | Target Uptime | Notes |
|-----------|--------------|-------|
| **Frontend (static files)** | 99.9% | Dependent on hosting provider CDN |
| **Firebase Firestore** | 99.95% | Google Cloud SLA |
| **Firebase Authentication** | 99.95% | Google Cloud SLA |
| **iCal CORS Proxies** | Best-effort | Third-party services; no SLA |

### 4.3 Graceful Degradation Requirements

| Requirement | Behavior When Service Unavailable |
|-------------|----------------------------------|
| **NFR-03-G1: Firestore Unavailable (first visit)** | Application renders using hardcoded `DEFAULT_DATA` (Sachi House Ojima Tokyo defaults). A functional page is always shown. |
| **NFR-03-G2: Firestore Unavailable (return visit)** | Application renders from `localStorage` cache. The user sees data from their last successful load. |
| **NFR-03-G3: iCal Proxies All Fail** | All dates are displayed as available. No error is shown to guests. The booking inquiry is still functional. |
| **NFR-03-G4: Authentication Unavailable** | Guest-only mode: all public content is accessible. Admin features are simply unavailable (no admin UI crash). |
| **NFR-03-G5: Individual iCal Feed Fails** | Only that feed is skipped. Dates from other feeds are still blocked correctly. |

### 4.4 Error Recovery

| Requirement | Detail |
|-------------|--------|
| **NFR-03-R1** | Failed Firestore writes (admin saves) must surface a clear error message in the admin UI and not corrupt the local cache. |
| **NFR-03-R2** | The application must not crash the entire page due to a failed background operation (iCal sync, settings load). All background operations must use `try/catch`. |
| **NFR-03-R3** | Unknown property IDs must render a usable page (via `DEFAULT_DATA`) rather than a blank screen or unhandled exception. |

---

## 5. NFR-04: Security

### 5.1 Overview

Security requirements are split between the client-side application and the Firebase backend. The Firebase Firestore Security Rules are the authoritative enforcement layer.

### 5.2 Authentication Security

| Requirement | Detail |
|-------------|--------|
| **NFR-04-A1** | Admin authentication must use Google OAuth 2.0 (no password management required). |
| **NFR-04-A2** | Email verification must be required for admin access (`email_verified === true` enforced in Firestore rules). |
| **NFR-04-A3** | Non-whitelisted Google accounts must be immediately and automatically signed out; no admin access is granted even momentarily. |
| **NFR-04-A4** | The admin email whitelist must be enforced server-side in Firestore Security Rules — not only client-side. |
| **NFR-04-A5** | Firebase session tokens are managed by the Firebase SDK; they are automatically refreshed and expire per Firebase's token lifecycle. |

### 5.3 Authorization Security (Firestore Rules)

| Requirement | Detail |
|-------------|--------|
| **NFR-04-Z1** | All Firestore collections must be publicly readable (allows guests to view content without authentication). |
| **NFR-04-Z2** | All Firestore write operations (create, update, delete) must require the admin identity (`isAdmin()` function in rules). |
| **NFR-04-Z3** | Document ID format must be validated server-side: only alphanumeric, dash, and underscore characters allowed (`^[a-zA-Z0-9_\-]+$`). |
| **NFR-04-Z4** | Field-level validation in Firestore rules must enforce maximum string lengths to prevent data bloat or injection via oversized inputs. |
| **NFR-04-Z5** | The `authorId` field on blog posts must be validated against the authenticated UID to prevent impersonation. |

### 5.4 Input Validation

| Requirement | Detail |
|-------------|--------|
| **NFR-04-V1** | All user inputs in the admin interface must be validated client-side before submission (required fields, format checks). |
| **NFR-04-V2** | URL fields (image URLs, iCal feed URLs, YouTube URL) must be validated for format before use. |
| **NFR-04-V3** | iCal feed URLs that contain literal placeholder text (`...`) must be silently rejected to prevent fetching invalid URLs. |
| **NFR-04-V4** | The booking inquiry `mailto:` URL must encode all guest-supplied values to prevent header injection. |

### 5.5 Data Exposure

| Requirement | Detail |
|-------------|--------|
| **NFR-04-E1** | No secrets, API keys, or private credentials may be embedded in the client-side JavaScript bundle. |
| **NFR-04-E2** | The Firebase configuration (`apiKey`, `projectId`, etc.) in `firebase-applet-config.json` is a public-facing config and must be secured using Firebase App Check or domain restrictions in the Google Cloud Console for production deployments. |
| **NFR-04-E3** | The admin email address (`betopham88@gmail.com`) is visible in `firestore.rules` (server-side, not in the JS bundle). The client-side `auth.ts` also contains it; this is acceptable for the single-admin architecture but should be noted in deployment docs. |

### 5.6 Content Security

| Requirement | Detail |
|-------------|--------|
| **NFR-04-CS1** | Blog content is rendered as Markdown via `react-markdown`. The renderer must not execute arbitrary HTML or scripts embedded in post content (use a sanitized renderer). |
| **NFR-04-CS2** | All external image sources displayed in the application originate from URLs entered by the admin — the admin is a trusted party. No public URL submission is available to guests. |
| **NFR-04-CS3** | iCal feed responses are parsed for date data only. No executable content from iCal responses is evaluated or rendered. |

---

## 6. NFR-05: Maintainability

### 6.1 Overview

The codebase must be structured to allow a single developer (or small team) to understand, modify, and extend features efficiently.

### 6.2 Code Organization

| Requirement | Detail |
|-------------|--------|
| **NFR-05-O1** | Source code must follow a feature/layer directory structure: `pages/`, `components/`, `services/`, `utils/`, `contexts/`, `data/`. |
| **NFR-05-O2** | All TypeScript interfaces must be centralized in `types.ts` to provide a single source of truth for data shapes. |
| **NFR-05-O3** | All Firestore CRUD operations must be encapsulated in `services/storage.ts`; page components must not import Firebase directly. |
| **NFR-05-O4** | Pricing calculation logic must be a pure function in `utils/pricing.ts`, isolated from React component state, to allow independent testing. |
| **NFR-05-O5** | Translation strings must be centralized in `utils/translations.ts`; no translated strings may be hardcoded in component JSX. |

### 6.3 TypeScript Requirements

| Requirement | Detail |
|-------------|--------|
| **NFR-05-T1** | All components, hooks, functions, and service methods must have TypeScript type annotations. No use of `any` type except where unavoidable (e.g., Firebase dynamic imports). |
| **NFR-05-T2** | `tsconfig.json` must target `ES2022` with `strict: true` to enforce type safety across the project. |
| **NFR-05-T3** | All data models passed between services and components must use interfaces defined in `types.ts`. |

### 6.4 Dependency Management

| Requirement | Detail |
|-------------|--------|
| **NFR-05-D1** | The project must use `package.json` to declare all dependencies with explicit version constraints. |
| **NFR-05-D2** | Firebase SDK (`firebase@^12`) must be imported using modular (tree-shakeable) API, not the legacy compat API. |
| **NFR-05-D3** | External dependencies must be minimized: prefer native browser APIs and small utilities over large frameworks for non-core functionality. |

### 6.5 Configuration Externalization

| Requirement | Detail |
|-------------|--------|
| **NFR-05-C1** | Firebase project configuration must be stored in `firebase-applet-config.json` (separate from source code) to allow environment-specific overrides. |
| **NFR-05-C2** | The Firestore database ID (named database) must be read from `firebase-applet-config.json`, not hardcoded in `firebase.ts`. |
| **NFR-05-C3** | Build configuration (aliases, plugin settings) must be defined in `vite.config.ts` to support consistent tooling across environments. |

---

## 7. NFR-06: Usability

### 7.1 Overview

The application must be immediately understandable and usable by guests with no prior familiarity with the platform.

### 7.2 Navigation & Information Architecture

| Requirement | Detail |
|-------------|--------|
| **NFR-06-N1** | All property pages must be reachable within 2 clicks from the listings page. |
| **NFR-06-N2** | Navigation labels must be customizable per property (`PropertyTitles`) to allow hosts to use language natural to their guest demographic. |
| **NFR-06-N3** | A back button or breadcrumb must be present on all sub-pages to allow guests to return to the previous context without using the browser back button. |
| **NFR-06-N4** | The mobile bottom navigation bar must persist across all property pages and always show the guest's current location. |

### 7.3 Booking Widget Usability

| Requirement | Detail |
|-------------|--------|
| **NFR-06-B1** | The price simulator must show a real-time price calculation as soon as valid dates and guest counts are selected — no explicit "Calculate" button required. |
| **NFR-06-B2** | Blocked/unavailable dates must be visually distinct from available dates with strikethrough and muted color styling. |
| **NFR-06-B3** | All validation errors in the booking widget must be shown inline, adjacent to the relevant input field, not in a modal or alert dialog. |
| **NFR-06-B4** | The price breakdown must be expandable/collapsible to keep the default view clean while providing full transparency on request. |

### 7.4 Admin Interface Usability

| Requirement | Detail |
|-------------|--------|
| **NFR-06-A1** | Admin save operations must provide clear visual feedback: a loading spinner during the save, followed by a "Saved!" confirmation or an error message. |
| **NFR-06-A2** | The admin interface must be accessible directly via `/{propertyId}/admin` without requiring navigation through a separate admin portal. |
| **NFR-06-A3** | Related settings must be grouped into clearly labeled tabs to minimize cognitive load. |
| **NFR-06-A4** | Destructive actions (property deletion) must require explicit user confirmation before execution. |

### 7.5 Content Display

| Requirement | Detail |
|-------------|--------|
| **NFR-06-C1** | Long property descriptions must be truncated with a "Show more / Show less" control to maintain a clean initial layout. |
| **NFR-06-C2** | Amenities lists with more than 10 items must be truncated with an expand option to avoid overwhelming the page. |
| **NFR-06-C3** | Manual items must use an accordion pattern so guests can find specific information without scrolling through all content. |

---

## 8. NFR-07: Accessibility

### 8.1 Overview

The application must be usable by people with disabilities, following WCAG 2.1 Level AA guidelines where technically feasible within the SPA architecture.

### 8.2 Keyboard Navigation

| Requirement | Detail |
|-------------|--------|
| **NFR-07-K1** | All interactive elements (buttons, links, form inputs) must be navigable via keyboard Tab/Shift-Tab. |
| **NFR-07-K2** | The photo lightbox gallery must support keyboard navigation: `←` `→` for previous/next image, `Escape` to close. |
| **NFR-07-K3** | Calendar popover in the booking widget must support keyboard navigation between dates (arrow keys). |
| **NFR-07-K4** | Accordion items in the manual page must be activatable via keyboard (Enter/Space). |

### 8.3 Screen Reader Support

| Requirement | Detail |
|-------------|--------|
| **NFR-07-SR1** | All images must have meaningful `alt` text derived from the `caption` field; decorative images must use `alt=""`. |
| **NFR-07-SR2** | Interactive buttons that contain only icons must have `aria-label` attributes describing their action. |
| **NFR-07-SR3** | Form inputs in the admin interface must have associated `<label>` elements or `aria-label` attributes. |
| **NFR-07-SR4** | Loading states must be announced to screen readers via `aria-live` regions or equivalent patterns. |

### 8.4 Visual Accessibility

| Requirement | Detail |
|-------------|--------|
| **NFR-07-V1** | Text color against background color must meet WCAG AA contrast ratio of at least 4.5:1 for normal text and 3:1 for large text. |
| **NFR-07-V2** | Focus indicators must be visible for all interactive elements. |
| **NFR-07-V3** | Blocked calendar dates must be indicated both by color (grey/muted) AND by strikethrough text, so the indication is not color-only. |
| **NFR-07-V4** | Error states in the booking widget must use both color (red) and an icon or text label, not color alone. |

### 8.5 Touch Target Size

| Requirement | Detail |
|-------------|--------|
| **NFR-07-T1** | All interactive touch targets on mobile must be at least 44×44 CSS pixels to meet Apple HIG and Google Material guidelines. |
| **NFR-07-T2** | Mobile bottom navigation tabs must provide sufficient spacing between adjacent tap targets. |

---

## 9. NFR-08: Compatibility

### 9.1 Browser Compatibility

| Browser | Minimum Version | Support Level |
|---------|----------------|---------------|
| **Google Chrome** | Latest 2 major versions | Full support |
| **Mozilla Firefox** | Latest 2 major versions | Full support |
| **Apple Safari** | Latest 2 major versions (macOS + iOS) | Full support |
| **Microsoft Edge** | Latest 2 major versions | Full support |
| **Samsung Internet** | Latest 2 major versions | Best-effort |

> The build target is `esnext` — no Babel transpilation is applied. Legacy browsers (IE11, pre-Chromium Edge) are explicitly **not** supported.

### 9.2 Device Compatibility

| Device Category | Screen Width | Behavior |
|----------------|-------------|---------|
| **Mobile (Phone)** | 320px – 767px | Single-column layout; bottom navigation; inline BookingWidget |
| **Tablet** | 768px – 1023px | Two-column layouts; top navigation may appear |
| **Desktop** | 1024px+ | Full multi-column layout; sticky BookingWidget; blog sidebar visible |

### 9.3 iOS Safari Specific

| Requirement | Detail |
|-------------|--------|
| **NFR-08-IOS1** | The mobile bottom navigation bar must use `env(safe-area-inset-bottom)` padding to accommodate the iOS home indicator and avoid content overlap. |
| **NFR-08-IOS2** | The application must not rely on CSS `position: fixed` behavior that differs in iOS Safari's scrolling context. |

### 9.4 Operating System Compatibility

The application runs in the browser and has no OS-specific dependencies beyond the browser listed above.

### 9.5 Network Compatibility

| Requirement | Detail |
|-------------|--------|
| **NFR-08-N1** | The application must remain functional (read-only, cached data) with intermittent connectivity. |
| **NFR-08-N2** | The iCal sync proxy chain must tolerate individual proxy failures by falling back to the next proxy. |
| **NFR-08-N3** | The application must not block the UI thread during network requests; all fetches must be asynchronous. |

---

## 10. NFR-09: Internationalization & Localization

### 10.1 Overview

The application targets an international guest audience visiting Japan, with a primary focus on guests from Japan, Vietnam, and East Asia.

### 10.2 Language Requirements

| Requirement | Detail |
|-------------|--------|
| **NFR-09-L1** | The UI must support 4 languages: English (`en`), Vietnamese (`vi`), Japanese (`ja`), and Simplified Chinese (`zh`). |
| **NFR-09-L2** | All UI strings (navigation labels, button text, error messages, section titles) must be sourced from the translation map in `utils/translations.ts`. No UI strings may be hardcoded in JSX. |
| **NFR-09-L3** | The translation system must provide a fallback chain: current language → English → raw key. The UI must never crash due to a missing translation key. |
| **NFR-09-L4** | The selected language must persist across browser sessions via `localStorage`. |
| **NFR-09-L5** | Language switching must take effect immediately without a page reload. |

### 10.3 Content Localization

| Requirement | Detail |
|-------------|--------|
| **NFR-09-C1** | Admin-entered property content (descriptions, rules, manual items, access text) is stored as-is and displayed in the language the admin entered it. |
| **NFR-09-C2** | Property-specific navigation labels may be overridden via `PropertyTitles` fields (applies to English mode only; other languages use translation keys). |
| **NFR-09-C3** | Date display in the availability calendar must use locale-appropriate formatting compatible with all 4 supported languages. |

### 10.4 Character Set

| Requirement | Detail |
|-------------|--------|
| **NFR-09-CH1** | All pages must declare `<meta charset="UTF-8">` to support Japanese kanji, Vietnamese diacritics, and Chinese characters. |
| **NFR-09-CH2** | All text storage (Firestore) uses UTF-8 natively; no character encoding conversion is required. |

---

## 11. NFR-10: SEO & Discoverability

### 11.1 Overview

The application must be discoverable by search engines, especially for the blog content which is designed to attract organic traffic.

### 11.2 Technical SEO Requirements

| Requirement | Detail |
|-------------|--------|
| **NFR-10-S1** | Each blog post page must set unique `<title>`, `<meta name="description">`, Open Graph (`og:*`), and Twitter Card (`twitter:*`) meta tags. |
| **NFR-10-S2** | The blog listing page and property pages must also set appropriate `<title>` and `<meta name="description">` tags. |
| **NFR-10-S3** | The `og:image` meta tag must reference an absolute URL to a real image (post hero image) to enable rich social preview cards. |
| **NFR-10-S4** | Each property must support a configurable `metaTitle` to allow SEO-optimized page titles independent of the display name. |
| **NFR-10-S5** | The property favicon must be configurable per property to allow platform-specific branding. |

### 11.3 Crawlability Considerations

| Requirement | Detail |
|-------------|--------|
| **NFR-10-C1** | The application uses **HashRouter** (`/#/path`) for routing. This means property pages are not directly crawlable by standard search engines without JavaScript rendering. Blog pages at `/blog` and `/blog/{id}` should be evaluated for server-side rendering or pre-rendering if SEO is critical. |
| **NFR-10-C2** | Blog content (the primary SEO target) is rendered via `react-markdown` on the client side. For maximum search engine visibility, consider pre-rendering blog pages at build time in a future version. |
| **NFR-10-C3** | All internal links must use relative paths compatible with the HashRouter scheme. |

### 11.4 Blog Content SEO

| Requirement | Detail |
|-------------|--------|
| **NFR-10-B1** | Blog posts must support a category taxonomy to enable category-scoped landing pages discoverable by search. |
| **NFR-10-B2** | Blog post excerpts (used as `og:description`) must be concise summaries (target: 120–160 characters). |
| **NFR-10-B3** | Blog post creation must record a `createdAt` timestamp that is immutable to avoid URL/date inconsistencies in search indexes. |

---

## 12. NFR-11: Portability & Deployability

### 12.1 Overview

The application must be easy to deploy across different hosting environments with minimal configuration.

### 12.2 Build Requirements

| Requirement | Detail |
|-------------|--------|
| **NFR-11-B1** | The application must produce a self-contained static build artifact (`dist/` folder) via `npm run build` (Vite). No server-side build step is required. |
| **NFR-11-B2** | The build must complete without errors or warnings in a clean `node_modules` environment (`npm ci && npm run build`). |
| **NFR-11-B3** | Build output must include code-split JS chunks, CSS bundles, and all static assets (images are URL-referenced, not bundled). |
| **NFR-11-B4** | The `@` path alias (resolves to project root) must be correctly configured in both `vite.config.ts` and `tsconfig.json` for consistent resolution at build and type-check time. |

### 12.3 Hosting Requirements

| Requirement | Detail |
|-------------|--------|
| **NFR-11-H1** | The application must be deployable to any static hosting service (Firebase Hosting, Vercel, Netlify, GitHub Pages, AWS S3+CloudFront). |
| **NFR-11-H2** | Because HashRouter is used, no server-side URL rewriting configuration is required. The `index.html` is always served for the root path. |
| **NFR-11-H3** | All dynamic data is fetched from Firebase at runtime; the static host stores only the JavaScript, CSS, and `index.html`. |

### 12.4 Environment Configuration

| Requirement | Detail |
|-------------|--------|
| **NFR-11-E1** | Firebase configuration must be loaded from `firebase-applet-config.json` at runtime, enabling different Firebase projects to be targeted by swapping this file without a code change. |
| **NFR-11-E2** | The development server must run on port 3000 (`vite.config.ts: server.port = 3000`) and be accessible at `http://localhost:3000`. |
| **NFR-11-E3** | Hot Module Replacement (HMR) must work in development mode for rapid iteration. |

---

## 13. NFR-12: Data Integrity

### 13.1 Overview

The system must ensure that data stored in Firestore is consistent, valid, and protected from accidental corruption.

### 13.2 Write Validation

| Requirement | Detail |
|-------------|--------|
| **NFR-12-W1** | All Firestore writes must be validated by server-side Security Rules before being accepted. Client-side validation is supplementary only. |
| **NFR-12-W2** | String fields must have maximum length limits enforced in Firestore rules to prevent data overflow. |
| **NFR-12-W3** | Array fields (rules, amenities, gallery) must be validated as Firestore lists in the security rules. |
| **NFR-12-W4** | The full `PropertyData` object is written on each admin save (full document overwrite). Partial updates are not used, eliminating partial-write inconsistency risk. |

### 13.3 ID Consistency

| Requirement | Detail |
|-------------|--------|
| **NFR-12-I1** | Property IDs must match the pattern `^[a-zA-Z0-9_\-]+$` (validated in Firestore rules). |
| **NFR-12-I2** | Blog post IDs must match the same pattern. |
| **NFR-12-I3** | New property IDs are generated client-side as random alphanumeric strings; collision probability is negligible but not formally guaranteed. |

### 13.4 Timestamp Integrity

| Requirement | Detail |
|-------------|--------|
| **NFR-12-T1** | Blog post `createdAt` timestamps must be set only on creation and never modified on subsequent updates. |
| **NFR-12-T2** | Blog post `updatedAt` timestamps must be refreshed on every update. |
| **NFR-12-T3** | iCal sync does not persist timestamps to Firestore; "Last Synced" data is stored in the local iCal feed list only. |

### 13.5 Cache Consistency

| Requirement | Detail |
|-------------|--------|
| **NFR-12-CC1** | After a successful admin save, the `localStorage` cache for the affected property must be updated with the new data in the same transaction-like sequence (write to Firestore → update cache). |
| **NFR-12-CC2** | If a Firestore write fails, the local cache must not be updated, preserving the last known good state. |

---

## 14. NFR-13: Privacy & Compliance

### 14.1 Overview

The system handles minimal personal data. The primary privacy consideration is the guest booking inquiry and admin authentication.

### 14.2 Guest Privacy

| Requirement | Detail |
|-------------|--------|
| **NFR-13-G1** | The system must not collect, store, or process any personal data from guests. There are no guest accounts, no form submissions stored server-side, and no analytics tracking (unless added separately). |
| **NFR-13-G2** | Booking inquiries are submitted via `mailto:` — they open the guest's own email client. No inquiry data passes through or is stored by the application's backend. |
| **NFR-13-G3** | Language preferences are stored in `localStorage` only and contain no personal identifiers. |

### 14.3 Admin Privacy

| Requirement | Detail |
|-------------|--------|
| **NFR-13-A1** | Admin authentication is handled entirely by Google (Firebase Auth). The application does not store passwords or authentication tokens outside of Firebase's managed SDK. |
| **NFR-13-A2** | The admin email address is used only for authentication comparison. It is not displayed publicly on any guest-facing page. |
| **NFR-13-A3** | The admin's Firebase UID is stored as `authorId` in blog posts. This UID is not personally identifiable to guests. |

### 14.4 Third-Party Services

| Service | Data Shared | Purpose |
|---------|------------|---------|
| **Firebase / Google Cloud** | Admin UID, property data, blog posts | Database and authentication |
| **Google Maps** | User IP (via iframe embed) | Property location map |
| **YouTube** | User IP (via iframe embed) | Access guide video |
| **CORS Proxies** | iCal feed URLs | Proxy for blocked-date sync |
| **OTA Platforms** | None (read-only iCal fetch) | Availability sync |

### 14.5 Japan Minpaku Compliance Notes

| Requirement | Detail |
|-------------|--------|
| **NFR-13-J1** | The application provides an informational platform only. Compliance with Japan's Minpaku Law (民泊法) requirements for registration, posting license numbers, and guest registration is the responsibility of the property operator — not enforced by this software. |
| **NFR-13-J2** | No processing of guest identity data (passport, ID) is performed by this system. |

---

## 15. NFR-14: Monitoring & Observability

### 15.1 Overview

As a single-admin static application, formal APM tooling is not required. However, basic observability mechanisms must exist to support issue diagnosis.

### 15.2 Error Logging

| Requirement | Detail |
|-------------|--------|
| **NFR-14-L1** | All caught exceptions in service functions (`storage.ts`, `auth.ts`, `ical.ts`) must be logged to `console.error` with sufficient context (operation name, error details). |
| **NFR-14-L2** | Firebase permission-denied errors must log the authentication state to assist admin diagnosis (was the admin logged in when the error occurred?). |
| **NFR-14-L3** | iCal sync operations must log: which feed is being fetched, which proxy succeeded/failed, and the count of blocked dates extracted per feed. |

### 15.3 User-Visible Feedback

| Requirement | Detail |
|-------------|--------|
| **NFR-14-F1** | Admin save errors must display a user-visible error message in the admin UI — not only in the browser console. |
| **NFR-14-F2** | Authentication errors (non-whitelisted email) must show an immediate inline alert message. |
| **NFR-14-F3** | iCal sync errors must not show any error to guests (silently fail with all dates shown as available). |

### 15.4 Future Monitoring Considerations

The following monitoring capabilities are **not required** in the current version but should be considered for future iterations:

| Capability | Tool Recommendation |
|------------|-------------------|
| Client-side error tracking | Sentry (browser SDK) |
| Performance monitoring | Google Lighthouse CI in CI/CD pipeline |
| Usage analytics | Google Analytics 4 (with GDPR consent) |
| Firestore usage monitoring | Firebase Console — Usage & Billing |
| Uptime monitoring | UptimeRobot or Firebase Hosting status alerts |

---

## 16. NFR Summary Table

| ID | Category | Requirement | Priority |
|----|----------|-------------|----------|
| NFR-01-C1 | Performance | Cache-first pattern for property data | High |
| NFR-01-C2 | Performance | Cache applied to both single and multi-property data | High |
| NFR-01-C3 | Performance | Admin save invalidates and refreshes cache | High |
| NFR-01-C4 | Performance | Auth init delayed 2s to protect LCP | High |
| NFR-01-S1 | Performance | All pages lazy-loaded via React.lazy | High |
| NFR-01-S2 | Performance | Firebase SDK dynamically imported | High |
| NFR-01-S3 | Performance | Code-split chunks per route | Medium |
| NFR-01-I1 | Performance | Off-screen images lazy-loaded | Medium |
| NFR-01-I2 | Performance | Hero images eager-loaded | Medium |
| NFR-01-I3 | Performance | Images specify dimensions to prevent CLS | Medium |
| NFR-01-IC1 | Performance | iCal sync is non-blocking | High |
| NFR-01-IC2 | Performance | iCal sync concurrency guard | Medium |
| NFR-01-IC3 | Performance | iCal proxy timeout ~5s per attempt | Medium |
| NFR-02-D1 | Scalability | New properties require no code changes | High |
| NFR-02-D2 | Scalability | Blog posts as individual Firestore documents | High |
| NFR-02-D3 | Scalability | Listings page supports pagination at > 20 properties | Low |
| NFR-02-I1 | Scalability | No server-side components to scale | High |
| NFR-02-I2 | Scalability | Firestore handles read scalability | High |
| NFR-02-I3 | Scalability | Static build deployable to CDN | High |
| NFR-02-U1 | Scalability | Unlimited concurrent guest readers | High |
| NFR-03-G1 | Reliability | Renders DEFAULT_DATA if Firestore unavailable (first visit) | High |
| NFR-03-G2 | Reliability | Renders from cache if Firestore unavailable (return visit) | High |
| NFR-03-G3 | Reliability | All dates available if iCal proxies fail | High |
| NFR-03-G4 | Reliability | Guest content accessible if Auth unavailable | High |
| NFR-03-G5 | Reliability | Partial iCal failure does not affect other feeds | Medium |
| NFR-03-R1 | Reliability | Failed saves surface error; cache not corrupted | High |
| NFR-03-R2 | Reliability | Background operations wrapped in try/catch | High |
| NFR-03-R3 | Reliability | Unknown property IDs render DEFAULT_DATA | Medium |
| NFR-04-A1 | Security | Admin uses Google OAuth 2.0 | High |
| NFR-04-A2 | Security | Email verification required for admin | High |
| NFR-04-A3 | Security | Non-whitelisted accounts immediately signed out | High |
| NFR-04-A4 | Security | Admin whitelist enforced server-side | High |
| NFR-04-Z1 | Security | Firestore collections publicly readable | High |
| NFR-04-Z2 | Security | Firestore writes require admin identity | High |
| NFR-04-Z3 | Security | Document ID format validated in Firestore rules | High |
| NFR-04-Z4 | Security | Field max lengths validated in Firestore rules | High |
| NFR-04-Z5 | Security | authorId validated against Firebase UID | High |
| NFR-04-V1 | Security | Admin inputs validated client-side | Medium |
| NFR-04-V2 | Security | URL fields validated for format | Medium |
| NFR-04-V3 | Security | Placeholder iCal URLs rejected | Medium |
| NFR-04-V4 | Security | mailto: URL encodes all guest values | High |
| NFR-04-E1 | Security | No secrets in client JS bundle | High |
| NFR-04-E2 | Security | Firebase config restricted by domain in production | High |
| NFR-04-CS1 | Security | Markdown renderer does not execute HTML/scripts | High |
| NFR-04-CS2 | Security | External image URLs from trusted admin only | Medium |
| NFR-04-CS3 | Security | iCal responses parsed for dates only | High |
| NFR-05-O1 | Maintainability | Feature/layer directory structure enforced | High |
| NFR-05-O2 | Maintainability | All interfaces centralized in types.ts | High |
| NFR-05-O3 | Maintainability | Firestore ops encapsulated in services/storage.ts | High |
| NFR-05-O4 | Maintainability | Pricing as pure function in utils/pricing.ts | High |
| NFR-05-O5 | Maintainability | Translations centralized in utils/translations.ts | High |
| NFR-05-T1 | Maintainability | All code has TypeScript type annotations | High |
| NFR-05-T2 | Maintainability | strict: true in tsconfig.json | High |
| NFR-05-T3 | Maintainability | Data models use types.ts interfaces | High |
| NFR-05-D2 | Maintainability | Firebase uses modular (tree-shakeable) API | High |
| NFR-05-C1 | Maintainability | Firebase config in external JSON file | High |
| NFR-06-N1 | Usability | Any page reachable in 2 clicks | High |
| NFR-06-N2 | Usability | Navigation labels customizable per property | Medium |
| NFR-06-N3 | Usability | Back navigation on all sub-pages | High |
| NFR-06-N4 | Usability | Mobile bottom nav persists on all property pages | High |
| NFR-06-B1 | Usability | Price shown without explicit Calculate button | High |
| NFR-06-B2 | Usability | Blocked dates visually distinct | High |
| NFR-06-B3 | Usability | Validation errors shown inline | High |
| NFR-06-B4 | Usability | Price breakdown expandable/collapsible | Medium |
| NFR-06-A1 | Usability | Admin save has loading + confirmation feedback | High |
| NFR-06-A4 | Usability | Destructive actions require confirmation | High |
| NFR-07-K1 | Accessibility | All interactive elements keyboard-navigable | High |
| NFR-07-K2 | Accessibility | Lightbox supports keyboard navigation | High |
| NFR-07-K3 | Accessibility | Calendar supports keyboard date navigation | Medium |
| NFR-07-SR1 | Accessibility | All images have meaningful alt text | High |
| NFR-07-SR2 | Accessibility | Icon-only buttons have aria-label | High |
| NFR-07-V1 | Accessibility | WCAG AA color contrast (4.5:1) | High |
| NFR-07-V2 | Accessibility | Visible focus indicators | High |
| NFR-07-V3 | Accessibility | Blocked dates indicated by both color AND strikethrough | High |
| NFR-07-T1 | Accessibility | Touch targets min 44×44 CSS pixels | High |
| NFR-08-N1 | Compatibility | Application functional with intermittent connectivity | High |
| NFR-09-L1 | i18n | 4 languages: EN, VI, JA, ZH | High |
| NFR-09-L3 | i18n | Translation fallback chain (language → EN → key) | High |
| NFR-09-L4 | i18n | Language persisted via localStorage | High |
| NFR-09-L5 | i18n | Language switch takes effect immediately | High |
| NFR-09-CH1 | i18n | UTF-8 charset declared | High |
| NFR-10-S1 | SEO | Blog posts have full OG + Twitter Card meta tags | High |
| NFR-10-S4 | SEO | Property metaTitle configurable | Medium |
| NFR-11-B1 | Deployability | Static build via `npm run build` | High |
| NFR-11-B2 | Deployability | Build completes without errors in clean env | High |
| NFR-11-H1 | Deployability | Deployable to any static hosting service | High |
| NFR-11-H2 | Deployability | No server-side URL rewrite needed (HashRouter) | High |
| NFR-11-E1 | Deployability | Firebase config swappable without code changes | High |
| NFR-12-W1 | Data Integrity | All Firestore writes validated server-side | High |
| NFR-12-W4 | Data Integrity | Full document overwrite prevents partial inconsistency | High |
| NFR-12-T1 | Data Integrity | createdAt is immutable | High |
| NFR-12-CC1 | Data Integrity | Cache updated after successful Firestore write | High |
| NFR-12-CC2 | Data Integrity | Cache not updated if Firestore write fails | High |
| NFR-13-G1 | Privacy | No guest personal data collected or stored | High |
| NFR-13-G2 | Privacy | Booking inquiry via mailto (no server storage) | High |
| NFR-14-L1 | Observability | Service exceptions logged with context | Medium |
| NFR-14-L2 | Observability | Permission-denied errors log auth state | Medium |
| NFR-14-F1 | Observability | Admin save errors shown in UI | High |
| NFR-14-F2 | Observability | Auth errors shown as inline alert | High |
| NFR-14-F3 | Observability | iCal errors not surfaced to guests | High |
