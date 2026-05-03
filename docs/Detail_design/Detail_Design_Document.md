# Detailed Design Document — SachiHouse78

**Project:** `sachihouse-hompage`  
**Version:** 0.0.0  
**Date:** May 2, 2026  
**Stack:** React 19 · TypeScript 5.8 · Vite 6 · Tailwind CSS 4 · Firebase 12 (Firestore + Auth)

---

## V2 Change Request Addendum (May 3, 2026)

This addendum supersedes Firebase-first assumptions in this document and defines the new baseline architecture.

### A. New Target Architecture (Full Stack)

- Frontend: React SPA (existing UI can be reused with API integration).
- Backend: Node.js TypeScript API service (recommended: NestJS or Express with layered architecture).
- Database: PostgreSQL 16 (managed service recommended) with read replicas when growth requires it.
- Cache: Redis for API/session/cache acceleration.
- Object Storage: S3-compatible bucket for media assets.
- Background Jobs: queue worker for iCal synchronization and heavy async tasks.

### B. Recommended Database (Replaces Firestore)

Primary recommendation: **PostgreSQL**.

Reasons:
- Strong relational modeling for properties, host assignment, roles, and audit logs.
- Better control over indexing/query plans for predictable performance.
- ACID transactions for multi-table updates (property + assignment + audit).
- Mature ecosystem for backup, migration, and observability.

### C. Identity and Roles (RBAC)

The system role model becomes:
- **Guest**: public read-only experience.
- **Host**: authenticated manager who can edit only properties assigned by Admin.
- **Admin**: full tenant-level control (users, assignments, global settings, all properties).

### D. Core API Domains

- Auth API: login, refresh, logout, session introspection.
- Property API: list/detail/create/update/delete.
- Assignment API: assign/unassign hosts to properties.
- Blog API: public read + Admin/Host managed write (policy-driven).
- Calendar API: iCal source management + normalized availability read model.

### E. Data Model Direction

At minimum, add relational entities:
- `users`
- `roles`
- `properties`
- `host_property_assignments`
- `blog_posts`
- `property_availability_blocks`
- `audit_logs`

### F. Migration Direction

- Introduce API and PostgreSQL in parallel with current UI.
- Migrate data from Firestore to PostgreSQL via one-time ETL and checksum validation.
- Switch frontend data layer to REST/GraphQL endpoints.
- Retire Firebase dependencies after production cutover.

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture Overview](#2-architecture-overview)
3. [Directory Structure](#3-directory-structure)
4. [Data Model (TypeScript Types)](#4-data-model-typescript-types)
5. [Routing Design](#5-routing-design)
6. [Pages — Detailed Design](#6-pages--detailed-design)
   - 6.1 [ListingsPage](#61-listingspage)
   - 6.2 [HomePage](#62-homepage)
   - 6.3 [AccessPage](#63-accesspage)
   - 6.4 [PricingPage](#64-pricingpage)
   - 6.5 [RulesPage](#65-rulespage)
   - 6.6 [ManualPage](#66-manualpage)
   - 6.7 [PhotoTourPage](#67-phototourpage)
   - 6.8 [AdminPage](#68-adminpage)
   - 6.9 [BlogPage](#69-blogpage)
   - 6.10 [BlogPostPage](#610-blogpostpage)
   - 6.11 [AdminBlogPage](#611-adminblogpage)
7. [Components — Detailed Design](#7-components--detailed-design)
   - 7.1 [Layout](#71-layout)
   - 7.2 [GlobalLayout](#72-globallayout)
   - 7.3 [TopNavBar](#73-topnavbar)
   - 7.4 [MobileBottomNav](#74-mobilebottomnav)
   - 7.5 [BookingWidget](#75-bookingwidget)
   - 7.6 [BlogSidebar](#76-blogsidebar)
   - 7.7 [SEOHead](#77-seohead)
8. [Services — Detailed Design](#8-services--detailed-design)
   - 8.1 [storage.ts](#81-storagets)
   - 8.2 [auth.ts](#82-authts)
   - 8.3 [blogService.ts](#83-blogservicets)
   - 8.4 [ical.ts](#84-icalts)
9. [Utilities — Detailed Design](#9-utilities--detailed-design)
   - 9.1 [pricing.ts](#91-pricingts)
   - 9.2 [translations.ts](#92-translationsts)
10. [Context — LanguageContext](#10-context--languagecontext)
11. [Firebase Configuration & Security Rules](#11-firebase-configuration--security-rules)
12. [Theming System](#12-theming-system)
13. [Caching Strategy](#13-caching-strategy)
14. [Multi-Property Support](#14-multi-property-support)
15. [SEO Design](#15-seo-design)
16. [Build & Development Configuration](#16-build--development-configuration)
17. [Data Flow Diagrams](#17-data-flow-diagrams)
18. [Key Design Decisions & Patterns](#18-key-design-decisions--patterns)

---

## 1. System Overview

SachiHouse78 is a **multi-property vacation rental management platform** targeting Japanese short-term rental (minpaku) operators. It serves two user groups:

| Role | Purpose |
|------|---------|
| **Guest** | Browse property details, check availability, calculate price, send booking inquiry |
| **Admin** | Manage property data, blog posts, iCal feeds, gallery, pricing, rules, manual |

The system is a **single-page application (SPA)** deployed as a static website. All dynamic content is persisted in **Firebase Firestore**. There is no backend server — all logic runs in the browser.

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Browser (React SPA)                          │
│                                                                     │
│  ┌─────────────┐  ┌──────────────────────────────────────────────┐  │
│  │  App.tsx    │  │   Pages (lazy-loaded via React.lazy)         │  │
│  │  (Router)   │  │   HomePage, AccessPage, PricingPage,         │  │
│  │             │  │   RulesPage, ManualPage, AdminPage,           │  │
│  │  HashRouter │  │   PhotoTourPage, BlogPage, BlogPostPage,      │  │
│  │  (/#/...)   │  │   AdminBlogPage, ListingsPage                 │  │
│  └──────┬──────┘  └──────────────────────────────────────────────┘  │
│         │                                                           │
│  ┌──────▼──────────────────────────────────────────────────────┐   │
│  │          Shared Components                                   │   │
│  │  Layout · GlobalLayout · TopNavBar · MobileBottomNav        │   │
│  │  BookingWidget · BlogSidebar · SEOHead                      │   │
│  └──────┬──────────────────────────────────────────────────────┘   │
│         │                                                           │
│  ┌──────▼──────────────────────────────────────────────────────┐   │
│  │          Services (async, dynamically imported)              │   │
│  │  storage.ts  ·  auth.ts  ·  blogService.ts  ·  ical.ts      │   │
│  └──────┬──────────────────────────────────────────────────────┘   │
│         │                                                           │
│  ┌──────▼──────────────────────────────────────────────────────┐   │
│  │          Utilities & Context                                  │   │
│  │  pricing.ts · translations.ts · LanguageContext              │   │
│  └──────┬──────────────────────────────────────────────────────┘   │
│         │                                                           │
└─────────┼───────────────────────────────────────────────────────────┘
          │  (firebase SDK)
┌─────────▼──────────────────────┐
│   Firebase Platform (Cloud)    │
│                                │
│  ┌──────────┐  ┌────────────┐  │
│  │Firestore │  │   Auth     │  │
│  │          │  │  (Google)  │  │
│  │/properties│  └────────────┘  │
│  │/blogPosts│                  │
│  │/settings │                  │
│  └──────────┘                  │
└────────────────────────────────┘
```

### Key Architectural Decisions

- **HashRouter** is used (not BrowserRouter) to support static hosting without server-side route handling.
- **Dynamic imports** (`React.lazy` + `Suspense`) are used for all page components to keep the initial bundle small.
- Firebase SDK modules are **dynamically imported** inside service functions to avoid bloating the critical path.
- A **two-layer cache** (in-memory + `localStorage`) reduces Firestore reads and allows offline-first rendering.

---

## 3. Directory Structure

```
/
├── App.tsx                  # Root component, router, theme injection, property data loading
├── firebase.ts              # Firebase app initialization, exports db, auth, googleProvider
├── firebase-applet-config.json  # Firebase project credentials (gitignored in production)
├── firebase-blueprint.json  # Firebase project blueprint/template metadata
├── firestore.rules          # Firestore security rules
├── index.html               # HTML entry point (Vite)
├── index.tsx                # React DOM root render, HelmetProvider, LanguageProvider
├── index.css                # Global CSS, Tailwind base
├── types.ts                 # All TypeScript interfaces and types
├── metadata.json            # App metadata
├── package.json
├── tsconfig.json
├── vite.config.ts
│
├── components/
│   ├── BlogSidebar.tsx      # Blog sidebar: search, categories, recent posts
│   ├── BookingWidget.tsx    # Price simulator + booking inquiry widget
│   ├── GlobalLayout.tsx     # Shell for blog/listing pages (TopNavBar + Footer)
│   ├── Layout.tsx           # Shell for property pages (desktop nav + mobile nav)
│   ├── MobileBottomNav.tsx  # Mobile-only bottom navigation bar
│   ├── SEOHead.tsx          # Dynamic <title> and <link rel="icon"> injection
│   └── TopNavBar.tsx        # Desktop top navigation for global pages
│
├── contexts/
│   └── LanguageContext.tsx  # i18n context: language state, t() function, persistence
│
├── data/
│   └── blogData.ts          # Mock/seed blog post data for initial database seeding
│
├── migrated_prompt_history/ # AI prompt history records (dev artifact)
│
├── pages/
│   ├── AccessPage.tsx       # Transport guide, map embed, YouTube walking guide
│   ├── AdminBlogPage.tsx    # Blog CRUD admin panel (auth-gated)
│   ├── AdminPage.tsx        # Property data admin panel (auth-gated, tabbed)
│   ├── BlogPage.tsx         # Blog listing with featured post, category filter, search
│   ├── BlogPostPage.tsx     # Blog post detail with Markdown rendering
│   ├── HomePage.tsx         # Property homepage: hero, gallery, highlights, amenities
│   ├── ListingsPage.tsx     # Multi-property listing page (platform homepage)
│   ├── ManualPage.tsx       # Accordion FAQ/manual for guests
│   ├── PhotoTourPage.tsx    # Full-screen categorized photo gallery
│   ├── PricingPage.tsx      # Availability calendar + pricing table
│   └── RulesPage.tsx        # House rules display
│
├── services/
│   ├── auth.ts              # Google Sign-In, admin email whitelist, auth state
│   ├── blogService.ts       # Firestore CRUD for blogPosts collection
│   ├── ical.ts              # iCal (.ics) fetcher and parser via CORS proxies
│   └── storage.ts           # Firestore CRUD for properties + settings; iCal refresh
│
└── utils/
    ├── pricing.ts           # Pure pricing calculation function
    └── translations.ts      # i18n strings for en, vi, ja, zh
```

---

## 4. Data Model (TypeScript Types)

All types are defined in `types.ts`.

### 4.1 `PropertyData` (Central Entity)

The root data object fetched from Firestore `properties/{propertyId}` and passed as a prop to all property-scoped pages.

| Field | Type | Description |
|-------|------|-------------|
| `id?` | `string` | Firestore document ID (injected on read) |
| `name` | `string` | Property display name |
| `metaTitle` | `string` | HTML `<title>` tag value |
| `metaFavicon` | `string` | URL for browser favicon |
| `subtitle` | `string` | Short tagline shown under property name |
| `description` | `string` | Full Markdown/text property description |
| `address` | `string` | Human-readable address |
| `mapEmbedUrl` | `string` | Google Maps embed iframe src URL |
| `hostName` | `string` | Host's display name |
| `hostImageUrl` | `string` | Host photo URL |
| `isSuperhost` | `boolean` | Airbnb Superhost badge flag |
| `superhostSince` | `string` | Year string |
| `themeColor` | `'blue' \| 'airbnb' \| 'booking' \| 'agoda'` | Color palette selector |
| `adminEmail` | `string` | Booking inquiry destination email |
| `maxGuests` | `number` | Physical maximum guest capacity |
| `bedrooms` | `number` | Bedroom count |
| `beds` | `number` | Total bed count |
| `baths` | `number` | Bathroom count |
| `highlights` | `HighlightItem[]` | 3 key selling points with icons |
| `accessInfo` | `AccessInfo` | Transport and check-in details |
| `additionalRules` | `string` | Free-text extra rules (shown on Rules page) |
| `pricing` | `PricingConfig` | Full pricing configuration |
| `rules` | `HouseRule[]` | Structured house rules list |
| `manual` | `ManualItem[]` | Guest guide accordion items |
| `icalFeeds` | `ICalFeed[]` | OTA calendar sync feed URLs |
| `amenities` | `string[]` | List of amenity names |
| `galleryCategories` | `GalleryCategoryDef[]` | Category definitions for photo gallery |
| `galleryImages` | `GalleryItem[]` | All property photos with category tags |
| `sleepingArrangements` | `SleepingArrangement[]` | Per-room sleeping configuration |
| `socialInfo?` | `SocialInfo` | Social/OTA platform links |
| `titles` | `PropertyTitles` | Overridable UI label strings |
| `emailJsConfig?` | `EmailJsConfig` | EmailJS integration config |

### 4.2 `PricingConfig`

Controls all price calculation logic used by `BookingWidget` and `PricingPage`.

```typescript
interface PricingConfig {
  rates: PricingTier[];          // Price per guest per night by guest count
  cleaning: CleaningTier[];      // Cleaning fee tiers by guest count range
  childDiscountPercent: number;  // e.g. 30 = 30% off per-guest price for children (age 3–10)
  childAgeMin: number;           // Min age for child category (default: 3)
  childAgeMax: number;           // Max age for child category (default: 10)
  longStayDiscountPercent: number; // e.g. 10 = 10% off subtotal for stays >= longStayMinNights
  longStayMinNights: number;     // Minimum nights to qualify for long-stay discount
}
```

**Default rates (Sachi House):**

| Guests | Price (¥/guest/night) |
|--------|-----------------------|
| 1–2    | ¥5,000                |
| 3      | ¥4,700                |
| 4      | ¥4,500                |
| 5      | ¥4,300                |
| 6–7    | ¥4,000                |

**Default cleaning fees:**

| Guest Range | Cleaning Fee (¥) |
|-------------|-----------------|
| 1–3         | ¥5,000           |
| 4           | ¥8,000           |
| 5–7         | ¥13,000          |

### 4.3 `BlogPost` (Firestore `blogPosts` collection)

```typescript
interface BlogPost {
  id: string;          // Firestore doc ID
  title: string;       // max 500 chars
  excerpt: string;     // max 1,500 chars
  content: string;     // Markdown, max 500,000 chars
  createdAt: number;   // Unix timestamp (ms)
  updatedAt: number;   // Unix timestamp (ms)
  imageUrl: string;    // max 2,000 chars
  category: string;    // max 100 chars
  isFeatured: boolean; // Promoted slot on BlogPage
  authorId: string;    // Firebase UID of creator
}
```

### 4.4 `SiteSettings` (Firestore `settings/listingsPage`)

```typescript
interface SiteSettings {
  navTitle: string;       // Top nav brand name
  headerTitle: string;    // ListingsPage hero title
  headerSubtitle: string; // ListingsPage hero subtitle
  footerTitle: string;    // Footer brand name
  footerCopyright: string;// Footer copyright line
}
```

### 4.5 Supporting Interfaces

| Interface | Fields | Purpose |
|-----------|--------|---------|
| `HouseRule` | `id, text, icon, type: 'allowed'\|'forbidden'` | House rules with icon key for `lucide-react` |
| `ManualItem` | `id, title, content, imageUrl?` | Guest manual accordion entry |
| `ICalFeed` | `id, name, url, lastSynced` | OTA iCal calendar sync source |
| `HighlightItem` | `id, title, description, icon` | Home page highlight card |
| `SleepingArrangement` | `id, title, description, imageUrl, photos?` | Per-room detail with lightbox photos |
| `AccessInfo` | `train, airport, checkIn, youtubeGuideUrl?` | Transport text blocks + video link |
| `SocialInfo` | `facebookUrl, footerImageUrl, airbnbUrl?, bookingUrl?, agodaUrl?` | Platform booking links |
| `GalleryItem` | `id, url, caption, category, showOnHome?` | Single photo with metadata |
| `GalleryCategoryDef` | `id, label` | Photo category definition |
| `PropertyTitles` | 12 label keys | All overridable UI text strings for a property |

---

## 5. Routing Design

The application uses **`HashRouter`** (URL format: `/#/path`). This enables deployment to any static host (GitHub Pages, Firebase Hosting) without server-side routing configuration.

### Route Tree

```
/                           → ListingsPage  (multi-property grid)
/blog                       → BlogPage       (blog listing)
/blog/:id                   → BlogPostPage   (blog post detail)
/blog/admin                 → AdminBlogPage  (auth-gated)

/:id                        → PropertyRoutes (dynamic, e.g. /main or /list_abc)
  /:id/                     → HomePage       (inside Layout)
  /:id/access               → AccessPage     (inside Layout)
  /:id/pricing              → PricingPage    (inside Layout)
  /:id/rules                → RulesPage      (inside Layout)
  /:id/manual               → ManualPage     (inside Layout)
  /:id/admin                → AdminPage      (inside Layout, auth-gated)
  /:id/photos               → PhotoTourPage  (standalone, no Layout)
```

### `PropertyRoutes` Component (in `App.tsx`)

This is a critical data-orchestration component. On mount:

1. Checks `localStorage` for a cached copy of `PropertyData` → renders immediately if found.
2. In parallel, calls `getPropertyData(propertyId)` from Firestore.
3. On success: updates state and writes new data back to `localStorage`.
4. On success: triggers `refreshBlockedDates()` to pull iCal feeds in background.
5. On error: falls back to `DEFAULT_DATA` (hardcoded Sachi House defaults).
6. Exposes `handleDataUpdate` callback to `AdminPage` to keep cache in sync after saves.

**State:**
- `data: PropertyData | null` — current property data
- `isSyncing: boolean` — shows spinner on first load
- `icalUpdate: number` — counter incremented to trigger re-renders after iCal sync

---

## 6. Pages — Detailed Design

### 6.1 ListingsPage

**File:** `pages/ListingsPage.tsx`  
**Route:** `/`  
**Layout:** Uses `TopNavBar` + `MobileBottomNav` directly (no `GlobalLayout` wrapping)

**Purpose:** Platform homepage showing all properties as cards. Serves as the admin's control panel for the multi-property system.

**Props:**
```typescript
interface ListingsPageProps {
  properties: (PropertyData & { id: string })[];
  settings: SiteSettings;
  onUpdateSettings: (settings: SiteSettings) => void;
}
```

**Features:**
- **Search bar:** Filters properties by `name` or `subtitle` using `searchQuery` state (client-side filter).
- **Admin mode:** Auth-aware. When admin is logged in:
  - Shows "Edit Page Content" button → opens settings modal.
  - Shows "New Listing" button → navigates to `/${newId}/admin` with a random 3-char ID.
  - Shows delete (trash) icon on each property card with confirmation dialog.
- **Settings modal:** Inline form to edit `SiteSettings` fields saved to Firestore `settings/listingsPage`.
- **Property cards:** Show name, subtitle, address, guest/bedroom/bathroom count, superhost badge, and a "View" link.

**Auth state:** Subscribes to `subscribeToAuth` to reactively show/hide admin controls.

---

### 6.2 HomePage

**File:** `pages/HomePage.tsx`  
**Route:** `/:id/` (index)  
**Layout:** Inside `Layout` component

**Purpose:** Primary guest-facing property listing page. Equivalent to an Airbnb listing page.

**Sections (top to bottom):**

1. **Hero Gallery Strip** — Shows up to 5 `showOnHome: true` images in a responsive grid. "Show all photos" button navigates to `/:id/photos`.
2. **Property Header** — Title, subtitle, key stats (guests/bedrooms/beds/baths), superhost badge.
3. **Highlights Bar** — 3 `HighlightItem` cards with Lucide icons and descriptions.
4. **Description** — Full property description with "Show more / Show less" toggle (truncated at 300 chars).
5. **Sleeping Arrangements** — Grid of `SleepingArrangement` cards. Each card has a thumbnail photo, title, description, and a "View photos" button that opens a `LightboxGallery` modal.
6. **Amenities** — Grid of amenity chips with icons. First 10 shown, expandable.
7. **Platform Booking Links** — Shows Airbnb / Booking.com / Agoda platform buttons from `socialInfo`.
8. **Map Embed** — Google Maps iframe using `data.mapEmbedUrl`.
9. **Host Info** — Host photo, name, superhost since badge, review count.

**Internal Components:**
- `LightboxGallery` — Full-screen modal with keyboard navigation (← → Esc), thumbnail strip.
- `PlatformButton` — OTA platform link button with first-letter avatar.

**BookingWidget placement:** Sticky on desktop (right column), inline on mobile (appears before the sleeping section).

---

### 6.3 AccessPage

**File:** `pages/AccessPage.tsx`  
**Route:** `/:id/access`  
**Layout:** Inside `Layout`

**Purpose:** Transport and arrival guide for guests.

**Sections:**
1. **Map Embed** — Full-width Google Maps iframe, grayscale by default, color on hover. Address overlay badge on desktop.
2. **YouTube Video Walking Guide** — Shown only when `data.accessInfo.youtubeGuideUrl` is set. Renders an `<iframe>` embed using the extracted YouTube video ID. Includes a fallback "Watch on YouTube" link for browsers that block iframes.
3. **Transport Cards** — Three cards for: By Train, From Airports, Check-in Details. Each renders the text as pre-formatted (newline-aware) content.

**YouTube ID extraction:** Supports `youtu.be/`, `watch?v=`, `embed/`, `shorts/` URL formats via regex.

---

### 6.4 PricingPage

**File:** `pages/PricingPage.tsx`  
**Route:** `/:id/pricing`  
**Layout:** Inside `Layout`

**Purpose:** Shows availability calendar, standard rates table, and the booking price simulator.

**Sections:**

1. **Price Simulator (`BookingWidget`)** — Mobile: shown above rules. Desktop: shown in right column (sticky).
2. **Pricing Rules Card** — Full rates table showing per-guest-count pricing and child/long-stay discount policies.
3. **Cleaning Fees Table** — Shows tiered cleaning fee by guest count.
4. **Availability Calendars** — Shows current month and next month side by side on desktop, stacked on mobile.

**Calendar rendering:**
- Uses `date-fns` for `eachDayOfInterval`, `endOfMonth`, `format`.
- Each day cell calls `isDateBlocked(day)` (synchronous, reads in-memory cache) to apply red strikethrough styling for unavailable dates.
- Navigation controls: "Previous Month" / "Next Month" buttons update `currentMonth` state.
- Hash navigation: If URL has `#rules`, scrolls to the rules section on mount.

---

### 6.5 RulesPage

**File:** `pages/RulesPage.tsx`  
**Route:** `/:id/rules`  
**Layout:** Inside `Layout`

**Purpose:** Displays structured house rules and additional free-text notes.

**Rendering:**
- Maps over `data.rules` array.
- Each rule has: icon (Lucide component resolved via `iconMap`), text, type badge (red dot for `forbidden`, green dot for `allowed`).
- Background color: `bg-red-50` for forbidden, `bg-green-50` for allowed.
- Additional rules shown in a grey card with `whitespace-pre-line` to preserve formatting.

---

### 6.6 ManualPage

**File:** `pages/ManualPage.tsx`  
**Route:** `/:id/manual`  
**Layout:** Inside `Layout`

**Purpose:** Accordion-style guest guide for appliances, garbage, Wi-Fi, etc.

**Features:**
- **Search input** — Filters `data.manual` by title and content fields (case-insensitive).
- **Accordion** — One item open at a time (`openId` state). First item open by default.
- Each open item shows: optional image (`imageUrl`), and `content` rendered with `whitespace-pre-line`.

---

### 6.7 PhotoTourPage

**File:** `pages/PhotoTourPage.tsx`  
**Route:** `/:id/photos`  
**Layout:** Standalone (no `Layout` wrapper, has its own fixed header)

**Purpose:** Full property photo gallery organized by room/category.

**Rendering logic:**
1. Reads `data.galleryCategories` for the ordered list of categories.
2. For each category, filters `data.galleryImages` by `category` field.
3. Floor plan category gets special treatment: first image rendered as `aspect-video` with `object-contain` (to show full plan without cropping).
4. All other categories render a 3-column grid with `aspect-[4/3]` images.
5. Back button calls `navigate(-1)` to return to previous page.

---

### 6.8 AdminPage

**File:** `pages/AdminPage.tsx`  
**Route:** `/:id/admin`  
**Layout:** Inside `Layout`

**Purpose:** Full CMS for property owners to edit all property data.

**Authentication gate:** Renders a login screen until Google Sign-In succeeds and email matches the admin whitelist.

**Tab structure:**

| Tab | Content Edited |
|-----|---------------|
| `general` | Name, subtitle, description, address, map URL, host details, social links, OTA URLs |
| `pricing` | Rate tiers, cleaning tiers, child/long-stay discount parameters |
| `ical` | iCal feed URLs (Airbnb, Booking.com, etc.) with add/remove |
| `amenities` | Toggle checkboxes for preset amenities; custom amenity text input |
| `rules` | Add/edit/delete house rules with icon and type selector |
| `manual` | Add/edit/delete guest guide accordion items |
| `gallery` | Add/edit/delete gallery images; category assignment; `showOnHome` toggle; category management |
| `rooms` | Add/edit/delete sleeping arrangements with photos |
| `highlights` | Edit 3 property highlight cards |
| `access` | Edit train/airport/check-in text blocks and YouTube URL |
| `labels` | Override all UI label strings (`PropertyTitles`) |

**Save flow:**
1. Calls `savePropertyData(formData, propertyId)` to write to Firestore.
2. On success, calls `onUpdate(formData)` prop to update parent `PropertyRoutes` state and `localStorage` cache.
3. Shows save status indicators: `idle` → `saving` → `saved` / `error`.

**Admin-only features visible on frontend:** The `Layout` component shows an "Admin" link in the nav only when the user is authenticated.

---

### 6.9 BlogPage

**File:** `pages/BlogPage.tsx`  
**Route:** `/blog`  
**Layout:** Inside `GlobalLayout`

**Purpose:** Travel blog listing with Tokyo-focused content.

**Data flow:**
1. On mount, calls `blogService.getPosts()` → sets `allPosts` state.
2. Uses `useMemo` to filter posts by `categoryFilter` (from `?category=` param) and `searchFilter` (from `?q=` param).

**Layout:**
- **Featured post** — Full-width hero card (only shown when no filter active). The post with `isFeatured: true`, or the first post as fallback.
- **Regular posts** — 2-column grid.
- **Sidebar** (`BlogSidebar`) — Search, categories, recent posts. Shown on the right on `lg` screens.

**SEO:** Uses `react-helmet-async` to set page-specific title, description, OG tags, and Twitter Card meta tags.

---

### 6.10 BlogPostPage

**File:** `pages/BlogPostPage.tsx`  
**Route:** `/blog/:id`  
**Layout:** Inside `GlobalLayout`

**Purpose:** Full blog post reader.

**Features:**
- Fetches post by `id` param via `blogService.getPostById(id)`.
- Renders `content` field using `react-markdown` (supports headings, bold, lists, etc.).
- Includes `BlogSidebar` for discovery.
- Admin edit button (pencil icon) shown when authenticated → navigates to `/blog/admin?edit={id}`.
- Full Open Graph + Twitter Card meta tags via `react-helmet-async`.

---

### 6.11 AdminBlogPage

**File:** `pages/AdminBlogPage.tsx`  
**Route:** `/blog/admin`  
**Layout:** Standalone

**Purpose:** Blog post CRUD management panel.

**Features:**
- Auth-gated (same Google login pattern as AdminPage).
- Post list with edit/delete actions.
- Inline editor with fields: title, excerpt, image URL, category, `isFeatured` toggle, content (textarea for Markdown).
- **Seed button** — Imports `mockBlogPosts` from `data/blogData.ts` and creates them all in Firestore. Used for initial database population.
- URL param `?edit={id}` — Opens the editor for a specific post on load (used by edit button on BlogPostPage).

---

## 7. Components — Detailed Design

### 7.1 Layout

**File:** `components/Layout.tsx`  
**Used by:** All property-scoped pages (via `<Route element={<Layout data={data} />}>`)

**Purpose:** Property-specific navigation shell.

**Structure:**
```
Layout
├── FloatingBackButton (mobile only, fixed top-left, returns to /)
├── DesktopNavbar (hidden on mobile)
│   ├── Back arrow to /
│   ├── Property name
│   ├── NavLinks (Home, Access, Pricing, Rules, Manual)
│   ├── Language toggle button (cycles: EN → VN → JP → CN)
│   └── Admin link (shown only when authenticated)
├── <Outlet /> (renders matched child route)
├── BookingWidget (sticky right column on desktop, rendered on ≥lg breakpoint)
│   Note: BookingWidget placement is actually inside individual pages,
│         not Layout itself. Layout renders <Outlet />.
└── Footer
    ├── Social platform buttons (Airbnb, Booking.com, Agoda)
    └── Copyright line
```

**Language toggle:** Cycles through `['en', 'vi', 'ja', 'zh']` array, updating `LanguageContext`.

**Nav labels:** Use `data.titles.menuXxx` when `language === 'en'` and a custom label is set, else fall back to `t('nav_xxx')` translation key.

---

### 7.2 GlobalLayout

**File:** `components/GlobalLayout.tsx`  
**Used by:** BlogPage, BlogPostPage

**Purpose:** Shell for non-property pages (blog, listings context).

**Structure:**
```
GlobalLayout
├── TopNavBar
├── <main> (max-w-[1280px] centered, responsive padding)
│   └── {children}
├── MobileBottomNav
└── Footer
    ├── Brand name (from SiteSettings.footerTitle)
    ├── Legal links (Privacy, Terms, Host Guidelines, Contact)
    └── Copyright (from SiteSettings.footerCopyright)
```

**Dynamic footer:** Fetches `SiteSettings` from Firestore on mount. Listens for `'site-settings-updated'` custom DOM event to refresh when admin saves settings.

---

### 7.3 TopNavBar

**File:** `components/TopNavBar.tsx`  
**Used by:** `GlobalLayout`, `ListingsPage`

**Purpose:** Desktop navigation for the global platform pages (blog, listings).

**Props:** `{ actionButton?: React.ReactNode }` — allows `ListingsPage` to inject the "Edit Page Content" button.

**Features:**
- Brand title link from `SiteSettings.navTitle` (fetched from Firestore, refreshes on `'site-settings-updated'`).
- Navigation: Properties (`/`) and Blog (`/blog`), with active underline styling.
- **Login/Logout dropdown:**
  - Unauthenticated: Settings gear icon → triggers `loginWithGoogle()`.
  - Authenticated: User avatar button → dropdown with user email, settings link, and logout.
- Click-outside detection to close dropdown.
- Desktop only (`hidden md:block`).

---

### 7.4 MobileBottomNav

**File:** `components/MobileBottomNav.tsx`  
**Used by:** `GlobalLayout`, `ListingsPage`

**Purpose:** Mobile bottom tab bar for the global pages.

**Features:**
- Tabs: Home (`/`), Blog (`/blog`), Admin (dropdown when authenticated) / Login.
- **Scroll hide/show:** Hides when scrolling down (threshold: 50px), shows when scrolling up. Smooth CSS transform transition.
- Safe area padding: Uses `env(safe-area-inset-bottom)` for iPhone home bar avoidance.
- Admin dropdown: Shows user email, navigate to `/main/admin`, logout option.
- Mobile only (`md:hidden`).

---

### 7.5 BookingWidget

**File:** `components/BookingWidget.tsx`  
**Used by:** `HomePage`, `PricingPage`

**Props:**
```typescript
interface BookingWidgetProps {
  pricing: PricingConfig;
  className?: string;
  adminEmail?: string;
}
```

**State:**
| State | Type | Description |
|-------|------|-------------|
| `checkIn` | `Date \| null` | Selected check-in date (default: today) |
| `checkOut` | `Date \| null` | Selected check-out date (default: today + 3) |
| `adults` | `number` | Adult guest count (default: 2) |
| `children` | `number` | Child guest count (default: 0) |
| `infants` | `number` | Infant count (default: 0, free of charge) |
| `isCalendarOpen` | `boolean` | Calendar popover visibility |
| `isGuestDropdownOpen` | `boolean` | Guest picker dropdown visibility |
| `selectingField` | `'checkIn' \| 'checkOut'` | Which date is being selected |
| `calendarViewMonth` | `Date` | Month shown in calendar |

**Calculation logic (via `useMemo`):**
1. Validates check-in is not in the past.
2. Validates check-out > check-in.
3. Checks all nights in range against `isDateBlocked()` (in-memory cache).
4. Calls `calculateHomestayPrice(adults, children, infants, nights, pricing)`.
5. Returns `CalculationResult` with breakdown or error message.

**Calendar UI:**
- Inline popover calendar rendered below the date input.
- Blocked dates shown in grey with strikethrough.
- Selected range highlighted.
- Two-step selection: first click = check-in, second click = check-out.
- Click outside closes via `mousedown` event listener.

**Email inquiry:** On "Send Booking Inquiry" button click, constructs a pre-filled email with `mailto:` protocol:
```
Subject: Booking Inquiry: Tokyo Zen Stay (YYYY-MM-DD - YYYY-MM-DD)
To: adminEmail || 'sachihouse.ad@gmail.com'
Body: Check-in, check-out, nights, guests, estimated price
```

**Price breakdown display:** Collapsible section showing: price per guest, adult total, child total, subtotal, long-stay discount (if applied), cleaning fee, final total.

---

### 7.6 BlogSidebar

**File:** `components/BlogSidebar.tsx`  
**Used by:** `BlogPage`, `BlogPostPage`

**Purpose:** Sidebar widget for the blog section.

**Sections:**
1. **Search form** — Navigates to `/blog?q={searchTerm}` on submit.
2. **Categories** — Computed from all blog posts. Sorted by post count descending. Each links to `/blog?category={name}`.
3. **Recent Posts** — Top 4 posts by `createdAt` desc. Thumbnail + title + date.

**Data:** Calls `blogService.getPosts()` once on mount. State: `recentPosts`, `categories`, `loading`.

---

### 7.7 SEOHead

**File:** `components/SEOHead.tsx`  
**Used by:** `App.tsx` (property scope)

**Purpose:** Imperative DOM manipulation for property-specific SEO (title + favicon).

**Implementation:** Uses `useEffect` to directly set `document.title` and update/create `<link rel="icon">` in the DOM head when `data` changes. Returns `null` (no visual output).

Note: Blog pages use `react-helmet-async` (`<Helmet>`) instead, since `react-helmet-async` requires a `HelmetProvider` wrapper already present at the root.

---

## 8. Services — Detailed Design

### 8.1 `storage.ts`

**Path:** `services/storage.ts`

**Firebase module lazy loading:**
```typescript
let firebasePromise: Promise<any> | null = null;
const getFirebaseModule = async () => { ... }; // Singleton pattern
```
All Firestore operations use dynamic imports to avoid including Firebase in the critical render path.

**Exported Functions:**

#### `getPropertyData(propertyId: string): Promise<PropertyData>`
- Reads `properties/{propertyId}` from Firestore.
- If document exists: merges with `DEFAULT_DATA` (handles partial/missing fields).
- If document doesn't exist: returns `DEFAULT_DATA`.
- On error: logs error details (including auth state) and returns `DEFAULT_DATA`.
- Injects `id: propertyId` into the returned object.

#### `getAllProperties(): Promise<(PropertyData & { id: string })[]>`
- Reads all documents from `properties` collection.
- Returns array with injected `id` field.

#### `savePropertyData(data: PropertyData, propertyId: string): Promise<void>`
- Writes with `setDoc` (full overwrite) to `properties/{propertyId}`.
- Throws on `permission-denied` with detailed error info.

#### `deletePropertyData(propertyId: string): Promise<void>`
- Deletes `properties/{propertyId}`.

#### `getSiteSettings(): Promise<SiteSettings>`
- Reads `settings/listingsPage`.
- Falls back to `DEFAULT_SITE_SETTINGS`.

#### `saveSiteSettings(settings: SiteSettings): Promise<void>`
- Writes to `settings/listingsPage`.

#### `isDateBlocked(date: Date): boolean`
- **Synchronous** — reads from in-memory `blockedDatesCache: Set<string>`.
- Returns true if `format(date, 'yyyy-MM-dd')` is in the cache.

#### `refreshBlockedDates(data: PropertyData): Promise<void>`
- Iterates `data.icalFeeds`, calls `fetchAndParseICal(url)` for each.
- Merges all returned date strings into `blockedDatesCache`.
- Dispatches `'ical-updated'` custom DOM event on completion.
- Guard: `isFetchingICal` flag prevents concurrent fetches.

**Default Data:** `DEFAULT_DATA` is a comprehensive hardcoded `PropertyData` object representing "Sachi House: Ojima Tokyo" — used as fallback when Firestore is unavailable.

---

### 8.2 `auth.ts`

**Path:** `services/auth.ts`

**Pattern:** Module-level `currentUser` variable updated by `onAuthStateChanged` listener (initialized 2 seconds after module load to avoid degrading LCP/FCP).

**Exported Functions:**

| Function | Signature | Description |
|----------|-----------|-------------|
| `checkAuth` | `() => boolean` | Synchronous — returns `!!currentUser` |
| `subscribeToAuth` | `(callback) => Promise<Unsubscribe>` | Async wrapper around `onAuthStateChanged` |
| `loginWithGoogle` | `() => Promise<boolean>` | Opens Google popup; whitelists only `betopham88@gmail.com`; auto-signs-out unauthorized emails |
| `logout` | `() => Promise<void>` | Signs out current user |

**Admin whitelist:** Hardcoded to `betopham88@gmail.com`. Any Google account that successfully authenticates but does not match this email is immediately signed out with an alert.

---

### 8.3 `blogService.ts`

**Path:** `services/blogService.ts`

**Collection:** `blogPosts`  
**Import style:** Direct (not lazy) — imports `db` and `auth` directly from `../firebase`.

**Exported object `blogService`:**

| Method | Signature | Description |
|--------|-----------|-------------|
| `getPosts` | `() => Promise<BlogPost[]>` | Lists all posts ordered by `createdAt` desc |
| `getPostById` | `(id: string) => Promise<BlogPost \| null>` | Fetches single post |
| `createPost` | `(post, customId?) => Promise<string>` | Creates post; uses provided `customId` or auto-generates |
| `updatePost` | `(id, updates) => Promise<void>` | Partial update with `updatedAt` timestamp |
| `deletePost` | `(id: string) => Promise<void>` | Deletes post document |

All methods wrap Firestore errors via `handleFirestoreError()` which logs auth context and rethrows.

---

### 8.4 `ical.ts`

**Path:** `services/ical.ts`

**Purpose:** Fetch and parse OTA iCal (`.ics`) calendar feeds to determine blocked/booked dates.

**CORS proxy chain:**
The application cannot directly fetch third-party iCal URLs from the browser due to CORS. Three proxies are tried in order:
1. `https://corsproxy.io/?url={encoded_url}&_t={timestamp}`
2. `https://api.codetabs.com/v1/proxy?quest={encoded_url}&_t={timestamp}`
3. `https://thingproxy.freeboard.io/fetch/{url}`

A cache-busting timestamp parameter is appended to proxies 1 and 2 to prevent stale responses.

**`fetchAndParseICal(url: string): Promise<string[]>`**
- Returns array of ISO date strings (`'yyyy-MM-dd'`) that are blocked.
- Skips URLs containing `...` (placeholder detection).
- Validates response contains `BEGIN:VCALENDAR` before parsing.
- Handles both JSON-wrapped responses (codetabs) and plain text.

**`parseICS(icsContent: string): Set<string>`**
- State machine parser: tracks `BEGIN:VEVENT` / `END:VEVENT` blocks.
- Extracts `DTSTART` and `DTEND` lines.
- Converts date range to daily set using `eachDayOfInterval`.
- Note: `DTEND` is exclusive per iCal spec — subtracts 1 day for inclusive range.

---

## 9. Utilities — Detailed Design

### 9.1 `pricing.ts`

**Path:** `utils/pricing.ts`

**Exported function:** `calculateHomestayPrice(adults, children, infants, nights, config): PriceResult`

**Algorithm:**

```
1. payingGuests = adults + children  (infants are free, excluded from pricing)
2. Validate: payingGuests >= 1
3. Validate: payingGuests <= max(config.rates[].guests)
4. pricePerGuest = config.rates.find(r => r.guests === payingGuests).price
5. adultTotal = adults × pricePerGuest × nights
6. childUnitPrice = pricePerGuest × (1 - childDiscountPercent/100)
7. childTotal = children × round(childUnitPrice) × nights
8. subtotal = adultTotal + childTotal
9. if nights >= longStayMinNights:
     discountedSubtotal = subtotal × (1 - longStayDiscountPercent/100)
   else:
     discountedSubtotal = subtotal
10. cleaningFee = config.cleaning.find(c => payingGuests in [c.minGuests, c.maxGuests]).price
11. total = round(discountedSubtotal + cleaningFee)
```

**Return type `PriceResult`:**
```typescript
{
  total: number;
  breakdown: {
    pricePerGuest: number;
    adultTotal: number;
    childTotal: number;
    subtotal: number;
    discountRate: number;      // 1.0 = no discount, 0.9 = 10% off
    discountedSubtotal: number;
    cleaningFee: number;
  };
  isValid: boolean;
  message?: string;            // Error description if isValid === false
}
```

---

### 9.2 `translations.ts`

**Path:** `utils/translations.ts`

**Supported languages:** `'en' | 'vi' | 'ja' | 'zh'`

**Structure:** Single `translations` object with language keys, each containing all UI string keys.

**Key categories:**
- Navigation labels (`nav_home`, `nav_access`, etc.)
- Booking widget labels (`sim_title`, `sim_checkin`, `sim_adults`, etc.)
- Home page labels (`home_show_photos`, `home_amenities`, etc.)
- Access page labels (`access_title`, `access_train`, etc.)
- Pricing page labels (`price_avail`, `price_rates`, etc.)
- Common labels (`loading`, `error`, `save`, `saved`)
- Footer labels (`footer_rights`)

**Total languages:** 4 (English, Vietnamese, Japanese, Simplified Chinese)

---

## 10. Context — LanguageContext

**File:** `contexts/LanguageContext.tsx`

**Context shape:**
```typescript
interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: keyof typeof translations['en']) => string;
}
```

**Persistence:** Language preference stored in `localStorage` under key `'app_language'`. Loaded on provider initialization with validation against the known language list.

**Translation function `t`:** 
```
t(key) → translations[language][key] 
       || translations['en'][key]  // English fallback
       || key                       // Key fallback (never undefined)
```

**Memoization:** `value` object memoized with `useMemo` keyed on `language` to prevent unnecessary re-renders of consumers.

**Usage pattern:** `const { t, language, setLanguage } = useLanguage()` inside any component wrapped by `LanguageProvider`.

---

## 11. Firebase Configuration & Security Rules

### 11.1 Firebase Setup (`firebase.ts`)

```typescript
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
```

- Configuration loaded from `firebase-applet-config.json`.
- Named Firestore database (not `(default)`) via `firestoreDatabaseId`.

### 11.2 Firestore Security Rules (`firestore.rules`)

**Default deny:** `match /{document=**} { allow read, write: if false; }` — explicit deny-all baseline.

**Admin function:**
```
isAdmin() = isSignedIn() 
          && email == "betopham88@gmail.com"
          && email_verified == true
```

**Collection rules:**

| Collection | Read | Write |
|------------|------|-------|
| `properties/{propertyId}` | Public `get` (by valid ID); public `list` | Admin only + `isValidPropertyData` |
| `blogPosts/{postId}` | Public `get`; public `list` | Admin only + `isValidBlogPost` |
| `settings/{settingId}` | Public `get`; public `list` | Admin only + `isValidSiteSettings` |

**Validation functions enforce field-level constraints:**

| Function | Key Constraints |
|----------|----------------|
| `isValidId(id)` | String, max 128 chars, alphanumeric + `_-` only |
| `isValidPropertyData(data)` | `name` ≤ 2000 chars, `description` ≤ 100,000 chars |
| `isValidBlogPost(data)` | `title` ≤ 500, `content` ≤ 500,000, timestamp fields are numbers, `isFeatured` is bool |
| `isValidSiteSettings(data)` | All string fields ≤ 500 chars (except subtitle ≤ 1,500) |

---

## 12. Theming System

**Location:** `App.tsx` — `THEMES` constant and `ThemeInjector` component.

**Mechanism:** CSS custom properties injected on `document.documentElement` via `root.style.setProperty`.

**Available themes:**

| Theme | Brand | Primary Color |
|-------|-------|---------------|
| `blue` (default) | Facebook Blue | `#2563EB` |
| `airbnb` | Airbnb Red/Pink | `#FF385C` |
| `booking` | Booking.com Navy | `#003580` |
| `agoda` | Agoda Teal | `#32a081` |

**CSS variables set:**
- `--color-primary-50` — Lightest tint (backgrounds)
- `--color-primary-100` — Light tint
- `--color-primary-200` — Medium-light tint
- `--color-primary-500` — Medium
- `--color-primary-600` — **Primary brand color**
- `--color-primary-700` — Darkest shade (hover states)

**Usage in Tailwind:** Theme colors are referenced via CSS variable in `index.css` / class mappings. `ThemeInjector` is rendered inside `PropertyRoutes` so each property can have its own theme.

---

## 13. Caching Strategy

The application implements a **three-tier caching system**:

### Tier 1: React State (In-Memory, per session)

- `PropertyRoutes` holds `data: PropertyData` in `useState`.
- `blockedDatesCache: Set<string>` in `storage.ts` module scope — persists across renders but not page reloads.
- Blog posts cached in page-level `useState`.

### Tier 2: `localStorage` (Persistent, per browser)

| Key | Contents | TTL |
|-----|----------|-----|
| `cache_property_{propertyId}` | Full `PropertyData` JSON | Manual invalidation (on admin save) |
| `cache_properties` | Array of all property summaries | Manual invalidation |
| `app_language` | User language preference (`'en'` etc.) | Permanent |

**Cache-first pattern in `PropertyRoutes`:**
```typescript
const [data, setData] = useState<PropertyData | null>(() => {
  const cached = localStorage.getItem(`cache_property_${propertyId}`);
  if (cached) { return JSON.parse(cached); }
  return null;
});
```
If cache exists, renders immediately (no loading spinner). Then fetches from Firestore in background and updates.

**Cache invalidation:** After admin saves via `handleDataUpdate`, both `cache_property_{id}` and `cache_properties` are updated to prevent stale flash.

### Tier 3: CORS Proxy Response (Browser Cache)

iCal proxies include `&_t={timestamp}` to bypass HTTP cache for proxies 1 and 2.

---

## 14. Multi-Property Support

The system is designed as a **multi-tenant platform**:

- Each property is stored as a separate Firestore document: `properties/{propertyId}`.
- `propertyId` defaults to `'main'` for the primary listing.
- New properties are created with random IDs like `list_abc`.
- All property-scoped routes are prefixed with `/:id/` (e.g., `/main/`, `/list_abc/access`).
- `ListingsPage` reads all properties and shows them as cards.
- The `Layout` component's navigation links are all relative to the current `propertyId`.

---

## 15. SEO Design

Two complementary SEO strategies are used:

### Property Pages (SEOHead)

**File:** `components/SEOHead.tsx`

Imperatively sets:
- `document.title` → `data.metaTitle || data.name`
- `<link rel="icon">` → `data.metaFavicon`

### Blog Pages (react-helmet-async)

**Provider:** `<HelmetProvider>` wraps the entire app in `index.tsx`.

Each blog page uses `<Helmet>` to set:
- `<title>` — Post-specific title
- `<meta name="description">` 
- `<meta property="og:title">`, `og:description`, `og:image`, `og:type`
- `<meta name="twitter:card">`, `twitter:title`, `twitter:description`, `twitter:image`

---

## 16. Build & Development Configuration

### `vite.config.ts`

```typescript
{
  server: { port: 3000, host: '0.0.0.0' },
  plugins: [react(), tailwindcss()],
  build: { target: 'esnext' },
  define: {
    'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
  },
  resolve: { alias: { '@': path.resolve(__dirname, '.') } }
}
```

- **Tailwind CSS** is integrated via `@tailwindcss/vite` plugin (not PostCSS).
- **`@` alias** maps to project root.
- **`esnext` build target** enables modern JS features.
- Environment variable `GEMINI_API_KEY` is exposed as `process.env.API_KEY` for any AI features.

### npm Scripts

| Script | Command | Purpose |
|--------|---------|---------|
| `dev` | `vite` | Start dev server on port 3000 |
| `build` | `vite build` | Production build to `dist/` |
| `preview` | `vite preview` | Preview production build locally |

### Key Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `react` | ^19.2.3 | UI framework |
| `react-dom` | ^19.2.3 | DOM rendering |
| `react-router-dom` | ^7.12.0 | Client-side routing |
| `firebase` | ^12.11.0 | Firestore + Authentication |
| `date-fns` | ^4.1.0 | Date arithmetic (calendar, iCal) |
| `lucide-react` | ^0.562.0 | Icon library |
| `react-markdown` | ^10.1.0 | Blog post Markdown rendering |
| `react-helmet-async` | ^3.0.0 | SEO meta tag management |
| `tailwindcss` | ^4.2.4 | Utility CSS framework |
| `@tailwindcss/typography` | ^0.5.19 | Prose styles for blog content |
| `typescript` | ~5.8.2 | Type safety |
| `vite` | ^6.2.0 | Build tool & dev server |

---

## 17. Data Flow Diagrams

### 17.1 Property Data Loading Flow

```
Browser loads /#/main
     │
     ▼
PropertyRoutes mounts
     │
     ├─► Check localStorage['cache_property_main']
     │        │
     │    Found? ──► setData(cached)  [instant render]
     │        │
     │    Not found? ──► setIsSyncing(true)  [show spinner]
     │
     ├─► getPropertyData('main')  [async Firestore fetch]
     │        │
     │        ├─► Success: setData(cloudData)
     │        │            write back to localStorage
     │        │            refreshBlockedDates(cloudData) [background]
     │        │
     │        └─► Error: setData(DEFAULT_DATA)  [fallback]
     │
     ▼
PropertyData available → render routes
```

### 17.2 Booking Inquiry Flow

```
Guest selects dates & guests in BookingWidget
     │
     ├─► Validate dates (not past, checkout > checkin)
     ├─► Check blocked dates (isDateBlocked, sync from cache)
     ├─► calculateHomestayPrice(adults, children, infants, nights, config)
     │        └─► Returns { total, breakdown, isValid }
     │
     ├─► Display price breakdown
     │
     └─► "Send Inquiry" clicked
              └─► Build mailto: URL with pre-filled email body
                  └─► window.location.href = mailto:...
                       └─► Opens system email client
```

### 17.3 Admin Save Flow

```
Admin edits property data in AdminPage
     │
     └─► "Save" clicked
              │
              ├─► savePropertyData(formData, propertyId)  [Firestore setDoc]
              │        └─► Success / Error
              │
              ├─► onUpdate(formData)  [prop callback to PropertyRoutes]
              │        └─► setData(newData)
              │            localStorage['cache_property_main'] = newData
              │            Update listings cache if exists
              │
              └─► refreshBlockedDates(newData)  [re-sync iCal]
```

### 17.4 iCal Sync Flow

```
refreshBlockedDates(propertyData) called
     │
     ├─► Guard: if isFetchingICal return early
     ├─► Set isFetchingICal = true
     │
     └─► For each icalFeed in propertyData.icalFeeds:
              │
              └─► fetchAndParseICal(feed.url)
                       │
                       ├─► Try proxy 1 (corsproxy.io)
                       │        └─► Valid iCal? → parse & return dates
                       │
                       ├─► Try proxy 2 (codetabs)
                       │        └─► Valid iCal? → parse & return dates
                       │
                       └─► Try proxy 3 (thingproxy)
                                └─► Valid iCal? → parse & return dates
     │
     ├─► Merge all dates into blockedDatesCache (Set<string>)
     ├─► isFetchingICal = false
     └─► dispatch 'ical-updated' event
              └─► PropertyRoutes: setIcalUpdate(n+1) → re-renders PricingPage calendar
```

---

## 18. Key Design Decisions & Patterns

### 18.1 Static SPA with Firebase Backend
The entire application is a static React SPA that communicates directly with Firebase from the browser. There is no Express/Node.js server, no REST API, no server-side rendering. This keeps operational complexity minimal — the app can be deployed to GitHub Pages, Firebase Hosting, or any CDN.

### 18.2 Dynamic Firebase SDK Imports
Firebase is only loaded when actually needed (on first Firestore/Auth operation). This pattern:
- Keeps the initial JS bundle small.
- Does not block the first paint.
- Module-level singleton promises (`firebasePromise`, `authPromise`) ensure the import only happens once.

### 18.3 Optimistic Rendering with Cache-First Loading
`PropertyRoutes` uses a `localStorage` cache as initial state. The page renders immediately with cached data (preventing a blank loading screen on return visits), then silently updates in the background. This is a simplified version of the stale-while-revalidate (SWR) pattern.

### 18.4 Property Data as Prop Drilling
`PropertyData` is fetched once at the `PropertyRoutes` level and passed directly as props to all child pages. This avoids context complexity while keeping all property-specific state co-located. The trade-off is that all pages receive the full `PropertyData` object even if they only need a subset.

### 18.5 Admin Whitelist via Firebase Auth + Firestore Rules
Admin authorization is enforced at two layers:
1. **Client-side** (`auth.ts`): Checks email after Google Sign-In and immediately signs out unauthorized users.
2. **Server-side** (`firestore.rules`): The `isAdmin()` function on Firestore rules re-validates the email token server-side, so even if the client-side check was bypassed, writes would be rejected.

### 18.6 Amenity Icon Resolution
Both `HomePage` and `AdminPage` maintain an `AMENITY_ICONS` record mapping amenity names to Lucide icon components. The lookup is case-insensitive with substring matching as a fallback. Adding a new amenity to the `AdminPage` checkbox list or `AMENITY_CATEGORIES` requires also adding an entry to `AMENITY_ICONS` in `HomePage` for proper icon rendering.

### 18.7 iCal CORS Proxy Chain
Direct browser fetches to Airbnb/Booking.com iCal URLs are blocked by CORS. The app uses a chain of three public CORS proxy services with automatic failover. This is a pragmatic solution for a small-scale property management app, though it introduces a dependency on third-party proxy services. Cache-busting timestamps prevent stale proxy responses.

### 18.8 HashRouter for Static Hosting Compatibility
`HashRouter` (URL fragment-based routing, `/#/path`) is used instead of `BrowserRouter`. This avoids the need for server-side URL rewriting rules, making deployment to any static file host straightforward. The trade-off is slightly less clean URLs.

### 18.9 Responsive Design Strategy
The app is built mobile-first with Tailwind CSS breakpoints:
- Mobile (`default`): Single-column layout, bottom navigation bar, BookingWidget inline.
- Desktop (`md:`, `lg:`): Multi-column layout, top navigation, sticky BookingWidget in right column.
- The property `Layout` hides the desktop nav on mobile and shows a floating back button instead.
- `MobileBottomNav` hides with a scroll-down gesture to maximize screen real estate.
