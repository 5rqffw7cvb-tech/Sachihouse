# Screen Design Document — SCR-12: Property Admin / Content Manager

**Screen ID:** SCR-12  
**Screen Name:** Property Content Manager  
**Route:** `/{id}/admin`  
**File:** `pages/AdminPage.tsx`  
**Layout Wrapper:** `Layout` (property nav + footer) with `max-w-6xl` override

---

## 1. Screen Overview

A comprehensive property CMS accessible to authenticated administrators. Contains 11 navigation tabs for managing all aspects of a property listing (text, images, pricing, rules, etc.). Features a sticky sidebar navigation on desktop and a horizontal scrollable pill-nav on mobile.

---

## 2. View States Overview

```
URL: /{id}/admin

  Not Authenticated          Authenticated
  ┌─────────────────┐        ┌─────────────────────────────────┐
  │  LOGIN GATE     │ ──────►│  CONTENT MANAGER (11 tabs)      │
  │  Lock icon      │        │  General | Gallery | Rooms | ... │
  │  "Login with    │        └─────────────────────────────────┘
  │   Google"       │
  └─────────────────┘
```

---

## 3. View 1: Login Gate

```
┌────────────────────────────────────┐
│  [min-h-60vh, centered card]       │
│                                    │
│  [🔒 blue icon circle]             │
│  Admin Access  (text-2xl bold)     │
│                                    │
│  [error message if login fails]    │
│                                    │
│  [  Login with Google  ]           │
│  (blue button, full-width)         │
│  (shows spinner + "Verifying..."   │
│   during auth)                     │
└────────────────────────────────────┘
```

| Element | Spec |
|---------|------|
| Card | `bg-white p-8 rounded-xl shadow-lg border border-gray-200 max-w-md` |
| Lock icon | `Lock` Lucide, `bg-blue-100 text-blue-600`, 48×48 circle |
| Title | "Admin Access" — `text-2xl font-bold text-center` |
| Error message | `text-red-500 text-sm text-center` — "Login failed or unauthorized." |
| Button | `bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-lg` |
| Loading state | `Loader2` spin animation + "Verifying..." label |

---

## 4. View 2: Content Manager Layout

### 4.1 Page Header

```
┌───────────────────────────────────────────────────────────┐
│  Content Manager (h1)        [↻ Logout] [💾 Save Changes] │
│                              [🗑 Delete] (non-main only)   │
└───────────────────────────────────────────────────────────┘
```

| Element | Spec |
|---------|------|
| Title | "Content Manager" — `text-2xl md:text-3xl font-bold` |
| Logout button | Triggers `logout()` + resets auth state |
| Save button | `bg-gray-900 hover:bg-gray-800 text-white`, `Save` icon + "Save Changes"; changes to "Saved!" (green) or "Error" (red) after action |
| Delete button | `text-red-600 bg-red-50 border border-red-200`; only shown for non-main properties; prompts `window.confirm` |

**Save status cycle:** idle → saving (spinner) → saved (green, 4s) → idle

### 4.2 Navigation Tabs

**11 tabs** defined in `NAV_ITEMS`:

| # | Tab ID | Label | Icon |
|---|--------|-------|------|
| 1 | `general` | General | `LayoutDashboard` |
| 2 | `gallery` | Gallery | `Image` |
| 3 | `rooms` | Rooms | `BedDouble` |
| 4 | `highlights` | Highlights | `Star` |
| 5 | `access` | Access | `Map` |
| 6 | `pricing` | Pricing | `DollarSign` |
| 7 | `ical` | iCal | `Calendar` |
| 8 | `amenities` | Amenities | `List` |
| 9 | `rules` | Rules | `FileText` |
| 10 | `manual` | Manual | `BookOpen` |
| 11 | `labels` | Text & Labels | `Type` |

**Mobile navigation:** Horizontal scroll strip of pill buttons (`rounded-full`, snap-x). Active = `bg-blue-600 text-white`.

**Desktop navigation:** Vertical sidebar list (`lg:col-span-1 sticky top-24`). Active = `bg-blue-50 text-blue-600`.

### 4.3 Main Grid Layout

```
┌───────────────────────────────────────────────────────┐
│  DESKTOP: grid-cols-4                                 │
│  ┌──────────────┐  ┌──────────────────────────────┐  │
│  │ SIDEBAR NAV  │  │ FORM CONTENT (col-span-3)    │  │
│  │ (col-span-1) │  │ bg-white border rounded-xl   │  │
│  │ General      │  │                              │  │
│  │ Gallery      │  │ [Active tab content]         │  │
│  │ Rooms        │  │                              │  │
│  │ ...          │  │                              │  │
│  └──────────────┘  └──────────────────────────────┘  │
└───────────────────────────────────────────────────────┘
```

Content panel: `bg-white border border-gray-200 rounded-xl shadow-sm p-4 md:p-8`.

---

## 5. Tab Content Specifications

### Tab 1: General

Fields for core property identity, contact, platforms, and social info.

| Field | Type | Notes |
|-------|------|-------|
| Property Name | `text input` | `data.name` |
| Description | `textarea` | `data.description` |
| Host Name | `text input` | `data.hostName` |
| Host Avatar URL | `text input` | `data.hostAvatar` |
| Superhost Label | `text input` | Override label text |
| Address | `text input` | `data.address` |
| Map Embed URL | `text input` | Google Maps iframe src |
| Primary Contact Email | `text input` | Booking inquiry destination |
| Custom URL (metalink) | `text input` | `/{metalink}/` — must be unique; server-validates against Firestore |
| Platform links | Repeater: platform name + URL + color | Airbnb, Booking.com, etc. |
| Social media links | Repeater: platform + URL | Instagram, YouTube, etc. |
| Superhost since (year) | `number input` | `data.superhostSince` |

**Metalink validation:**
- Sanitized: lowercase, alphanumeric + hyphens only, no leading/trailing hyphens
- Uniqueness: checked against Firestore `properties` collection before save
- Error shown inline if duplicate found

### Tab 2: Gallery

Manages the property's photo gallery organized into custom categories.

| Feature | Detail |
|---------|--------|
| Category management | "+ Add Category" button; each category has `label` and `slug`; delete with trash icon |
| "Manage Categories" toggle | Expands a category editor panel |
| Photo entries | Per-category or uncategorized; each entry has `url` + `alt` + `category` fields |
| Add photo | "Add Photo" button appends new empty entry to `formData.gallery[]` |
| Delete photo | Trash icon per row |
| Drag-to-reorder | Not implemented — manual order by position |
| Preview | Small `img` thumbnail next to URL field |

### Tab 3: Rooms

Manages sleeping arrangement cards.

| Field | Type |
|-------|------|
| Room Name | `text input` |
| Description | `text input` |
| Bed Configuration | `text input` |
| Icon | `select` (icon key) |
| Image URL | `text input` |

Actions: "Add Room" button / trash icon per room.

### Tab 4: Highlights

Up to 3 highlight bullet points shown on the homepage.

| Field | Type |
|-------|------|
| Icon | `select` (from `HIGHLIGHT_ICON_OPTIONS`) |
| Title | `text input` |
| Description | `text input` |

### Tab 5: Access

| Field | Type | Notes |
|-------|------|-------|
| Train Info | `textarea` | `accessInfo.train`; supports multi-line (pre-line) |
| Airport Info | `textarea` | `accessInfo.airport` |
| Check-in Details | `textarea` | `accessInfo.checkIn` |
| YouTube Guide URL | `text input` | `accessInfo.youtubeGuideUrl`; any YouTube URL format |

### Tab 6: Pricing

**Rate Tiers:**

| Field | Detail |
|-------|--------|
| Rates table | One row per guest count: guests, pricePerGuest, cleaningFee |
| Add tier | "Add Rate" appends new row |
| Remove tier | Trash icon per row |

**Discount Settings:**

| Field | Type |
|-------|------|
| Long Stay Min Nights | `number input` |
| Long Stay Discount % | `number input` |
| Child Discount % | `number input` |
| Child Age Min | `number input` |
| Child Age Max | `number input` |

### Tab 7: iCal

Manages iCal feed URLs for syncing blocked dates from OTA platforms.

| Field | Detail |
|-------|--------|
| Feed Name | `text input` (e.g., "Airbnb") |
| iCal URL | `text input` (`.ics` feed URL) |
| Last Synced | Read-only timestamp |
| Sync Now | Button triggers `icalService.sync(feed.url)` |
| Add Feed | "Add Feed" button appends new entry |
| Remove Feed | Trash icon per row |

### Tab 8: Amenities

Two-part: preset toggles + custom free-text entries.

| Feature | Detail |
|---------|--------|
| Preset categories | Groups: Essentials, Kitchen, Bathroom, Features, Safety |
| Preset item | Checkbox toggle; adds/removes from `formData.amenities[]` |
| Custom amenity | Text input + "Add" button; appends to amenities list |
| Remove custom | Trash icon per custom entry |

### Tab 9: Rules

| Field | Type |
|-------|------|
| Icon | `select` from `ICON_OPTIONS` (10 icons) |
| Rule text | `text input` |
| Type | `select`: `forbidden` / `allowed` |
| Additional Notes | `textarea` — maps to `data.additionalRules` |

Actions: "Add Rule" / trash icon per rule.

### Tab 10: Manual

| Field | Type |
|-------|------|
| Title | `text input` |
| Content | `textarea` (multi-line, pre-line) |
| Image URL | `text input` (optional photo for expanded view) |

Actions: "Add Manual Item" / trash icon.

### Tab 11: Text & Labels

Bulk-edit UI for all text strings on the property site.

| Sub-group | Fields |
|-----------|--------|
| Page Titles | `homepage`, `photos`, `access`, `pricing`, `rules`, `manual` titles + subtitles |
| Navigation Labels | Labels for nav bar tabs |
| Button / CTA text | "Book Now", "Contact", etc. |
| Footer text | Brand name, copyright |

---

## 6. States

| State | Behavior |
|-------|---------|
| Not authenticated | Login gate shown (View 1) |
| Authenticated | Content Manager shown (View 2) |
| Saving | "Saving..." spinner on button |
| Save success | Button turns green "Saved!" for 4s |
| Save error | Button turns red "Error" for 4s; error message shown in banner |
| Metalink duplicate | Error banner: "Custom URL is already taken." — save aborted |
| GitHub cloud sync enabled without session password | Warning banner with re-login prompt |

---

## 7. Responsive Behavior

| Element | Mobile | Desktop (`lg+`) |
|---------|--------|-----------------|
| Tab navigation | Horizontal scroll pill bar | Vertical sticky sidebar |
| Main grid | Single column | 1+3 column grid |
| Page header | Stacked (title above buttons) | Side-by-side row |
| Form padding | `p-4` | `p-8` |

---

## 8. Navigation Flows

```
SCR-12 Property Admin
  │
  ├── [Unauthenticated] Login → Google OAuth → Content Manager
  ├── Logout → Login gate (same URL)
  ├── Save Changes → Persist to Firestore, show success/error
  ├── Delete Property → confirm → delete Firestore doc → redirect /#/
  ├── Tab navigation → in-page tab switch (no URL change)
  └── [Gallery] Photo uploads → Firebase Storage (via URL, not direct upload)
```

---

## V2 Change Request Addendum (2026-05-03)

### Backend + DB Integration

- All property CMS tabs must persist through backend Property API, not direct client DB writes.
- Metalink uniqueness validation must be executed server-side against PostgreSQL constraints/indexes.
- Save operation should support partial updates and optimistic concurrency controls.

### Role Updates

- Host can access this page only for properties assigned by Admin.
- Admin can access and edit any property plus manage host assignments.

### New Admin Capability

- Add Assignment Management section/tab to assign or revoke Host access per property.
