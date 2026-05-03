# Screen Design Document — SCR-01: Property Listings Page

**Screen ID:** SCR-01  
**Screen Name:** Property Listings Page  
**Route:** `/` (platform root)  
**File:** `pages/ListingsPage.tsx`  
**Layout Wrapper:** `GlobalLayout` (TopNavBar + Footer)

---

## 1. Screen Overview

The platform homepage and entry point for all visitors. Displays all registered rental properties as browsable cards. Provides admin tools to manage the property portfolio and site settings.

---

## 2. Wireframe — Desktop

```
┌─────────────────────────────────────────────────────────────────┐
│  TOP NAV BAR                                                    │
│  [Brand Title]        [Properties] [Blog]  [Admin ▾] [Login]   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  HEADER SECTION                       [Edit Page Content] [New]│
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ <headerTitle>                                           │   │
│  │ <headerSubtitle>                                        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  [🔍 Search properties...]                        [Filter ⊞]   │
│                                                                 │
│  PROPERTY GRID (3 columns on lg, 2 on md, 1 on sm)             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │ [Image 4:3]  │  │ [Image 4:3]  │  │ [Image 4:3]  │         │
│  │ ♥ (top-right)│  │ ♥            │  │ ♥            │         │
│  │ ★ Superhost  │  │              │  │              │         │
│  │──────────────│  │──────────────│  │──────────────│         │
│  │ Name  ★ 4.96│  │ Name  ★ 4.96│  │ Name  ★ 4.96│         │
│  │ subtitle     │  │ subtitle     │  │ subtitle     │         │
│  │ 👥N  🛏N  🛁N│  │ 👥N  🛏N  🛁N│  │ 👥N  🛏N  🛁N│         │
│  │ [View →]     │  │ [View →]     │  │ [View →]     │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
│  ┌──────────────┐  ...                                          │
│  │ [Trash icon] │  (Admin only)                                 │
│  └──────────────┘                                               │
├─────────────────────────────────────────────────────────────────┤
│  FOOTER                                                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Wireframe — Mobile

```
┌─────────────────────────┐
│  Brand Title            │
│  (No top nav - hidden)  │
├─────────────────────────┤
│ <headerTitle>           │
│ <headerSubtitle>        │
├─────────────────────────┤
│ [🔍 Search properties..]│
├─────────────────────────┤
│  PROPERTY CARD (1 col)  │
│ ┌─────────────────────┐ │
│ │  [Image 4:3]       ♥│ │
│ │  ★ Superhost        │ │
│ │─────────────────────│ │
│ │  Name          ★4.96│ │
│ │  subtitle           │ │
│ │  👥N  🛏N  🛁N      │ │
│ └─────────────────────┘ │
│  (repeat for each card) │
├─────────────────────────┤
│  MOBILE BOTTOM NAV      │
│ [🏠][📅][✉][👤]         │
└─────────────────────────┘
```

---

## 4. UI Components

### 4.1 TopNavBar

| Element | Type | Visible To | Behavior |
|---------|------|-----------|---------|
| Brand title | Text link | All | Links to `/` |
| Properties link | Navigation link | All | Links to `/` |
| Blog link | Navigation link | All | Links to `/blog` |
| Admin dropdown | Button + dropdown | Admin only | Shows user email + Sign Out option |
| Login icon | Button | Guest | Triggers Google Sign-In |
| Edit Page Content | Button | Admin only | Opens settings modal |
| New Property | Button | Admin only | Generates new ID, navigates to `/{id}/admin` |

### 4.2 Header Section

| Element | Type | Content Source |
|---------|------|---------------|
| Title (H1) | Heading | `settings.headerTitle` |
| Subtitle | Paragraph | `settings.headerSubtitle` (supports `\n`) |

### 4.3 Search Bar

| Element | Type | Behavior |
|---------|------|---------|
| Search input | Text field with left search icon | Filters property cards in real-time by name or subtitle (client-side, case-insensitive) |
| Filter button | Icon button | Visual placeholder (no filter modal implemented) |

### 4.4 Property Card

| Zone | Element | Source | Notes |
|------|---------|--------|-------|
| Image | `<img>` 4:3 aspect ratio | First `showOnHome` gallery image, else placeholder | First card `loading="eager"`, rest lazy |
| Overlay — top-left | Superhost badge | `property.isSuperhost` | Dark green pill with star icon |
| Overlay — top-right | Favorite (♥) button | None (visual only) | No action currently wired |
| Content — row 1 | Property name + star rating | `property.name`, hardcoded 4.96 | Line-clamp-1 |
| Content — row 2 | Subtitle | `property.subtitle` | Fallback: "Property in Tokyo" |
| Content — row 3 | Stats row | `maxGuests`, `bedrooms`, `baths` | Icons: Users, BedDouble, Bath |
| Admin overlay | Trash icon | Admin only | Floats bottom-right; confirms then calls `deletePropertyData` |

---

## 5. Settings Modal (Admin Only)

Triggered by "Edit Page Content" button. Full-screen modal overlay.

| Field | Input Type | Mapped Field |
|-------|-----------|-------------|
| Nav Title | Text input | `settings.navTitle` |
| Page Header Title | Text input | `settings.headerTitle` |
| Page Header Subtitle | Textarea | `settings.headerSubtitle` |
| Footer Brand Name | Text input | `settings.footerBrand` |
| Footer Copyright | Text input | `settings.footerCopyright` |
| Save | Button | Calls `saveSiteSettings()`, emits `'site-settings-updated'` DOM event |
| Cancel / × | Button | Closes modal, discards changes |

---

## 6. States

| State | Display |
|-------|---------|
| Loading (properties fetching) | Not applicable — data passed as prop from `App.tsx` |
| Empty state (0 properties) | Empty grid (no explicit empty state message) |
| Deleting a property | Trash icon shows `<Loader2>` spinner while `deletePropertyData` runs |
| Search with no results | Empty grid (filtered list is empty) |
| Settings saving | "Edit Page Content" shows spinner |

---

## 7. Responsive Behavior

| Breakpoint | Layout |
|------------|--------|
| Mobile (< `md`) | 1-column card grid; TopNavBar action buttons hidden; MobileBottomNav shown |
| Tablet (`md`) | 2-column card grid; Edit/New buttons visible in TopNavBar |
| Desktop (`lg`) | 3-column card grid; full layout |

---

## 8. Navigation Flows

```
SCR-01 Listings
  │
  ├── Click property card → SCR-02 Property Homepage (/{id}/)
  ├── Click Blog → /blog (SCR-09 Blog Listing)
  ├── [Admin] Click "New Property" → /{newId}/admin (SCR-11 Admin Property)
  └── [Admin] Click trash icon (confirm) → delete property, stay on SCR-01
```

---

## V2 Change Request Addendum (2026-05-03)

### Backend + DB Integration

- Property listing data must be loaded from backend API (`GET /api/v1/properties`) instead of direct Firestore reads.
- Search and filter should be server-assisted for scale (query params) with paginated responses.
- Delete/create actions must call authenticated API endpoints and require role authorization.

### Role Updates

- Guest: can browse listings only.
- Host: can see and manage only listings assigned by Admin.
- Admin: full access to all listings and assignment controls.

### Additional UI Requirement

- The page should expose assignment status badges (for authenticated Admin/Host) to indicate ownership responsibility.
