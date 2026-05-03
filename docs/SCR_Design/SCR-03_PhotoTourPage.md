# Screen Design Document — SCR-03: Photo Tour Page

**Screen ID:** SCR-03  
**Screen Name:** Photo Tour  
**Route:** `/{id}/photos`  
**File:** `pages/PhotoTourPage.tsx`  
**Layout Wrapper:** None (standalone full-screen page with its own fixed header)

---

## 1. Screen Overview

A dedicated full-screen gallery that displays all property photos organized by category. It is intentionally minimal — no navigation bar, no footer — so the photos take center stage.

---

## 2. Wireframe

```
┌─────────────────────────────────────────────────────────────┐
│  FIXED HEADER (white/95, backdrop-blur, border-bottom)      │
│  [← Back]  Photo tour                                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  FLOOR PLAN  (shown only if 'plan' category has images)     │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  aspect-video image (object-contain, mix-blend)     │    │
│  └─────────────────────────────────────────────────────┘    │
│  "Caption text"                                             │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐                  │
│  │ extra img │ │ extra img │ │ extra img │  (if any)        │
│  └───────────┘ └───────────┘ └───────────┘                  │
│                                                             │
│  LIVING ROOM  (shown only if 'living' category has images)  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  aspect-video hero image (object-cover)             │    │
│  └─────────────────────────────────────────────────────┘    │
│  "Caption text"                                             │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐                  │
│  │ thumb img │ │ thumb img │ │ thumb img │                  │
│  └───────────┘ └───────────┘ └───────────┘                  │
│                                                             │
│  KITCHEN & DINING  (dynamic category)                       │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐                  │
│  │  4:3 img  │ │  4:3 img  │ │  4:3 img  │                  │
│  │           │ │           │ │           │                  │
│  └───────────┘ └───────────┘ └───────────┘                  │
│  "caption"     "caption"     "caption"                      │
│                                                             │
│  BEDROOM  (dynamic category)                                │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐                  │
│  │  4:3 img  │ │  4:3 img  │ │  4:3 img  │                  │
│  └───────────┘ └───────────┘ └───────────┘                  │
│                                                             │
│  ... (additional categories in galleryCategories order)     │
│                                                             │
│  UNCATEGORIZED PHOTOS  (orphaned images, if any)            │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐                  │
│  │  4:3 img  │ │  4:3 img  │ │  4:3 img  │                  │
│  └───────────┘ └───────────┘ └───────────┘                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. UI Components

### 3.1 Fixed Header

| Element | Type | Behavior |
|---------|------|---------|
| Back button | `<button>` with `ChevronLeft` icon | Calls `navigate(-1)` — returns to previous page |
| Page title | Static text | "Photo tour" (hardcoded) |
| Background | `bg-white/95 backdrop-blur` | Stays fixed at top during scroll |

### 3.2 Floor Plan Section

Rendered when `galleryImages.filter(img => img.category === 'plan').length > 0`.

| Element | Spec |
|---------|------|
| Hero image | `aspect-video` container, `object-contain`, `mix-blend-multiply` (preserves floor plan on white bg) |
| Caption | `text-sm text-gray-500` below hero |
| Additional images | 2–3 column grid, `aspect-[4/3]`, `object-cover` with hover scale effect |

**Design rationale:** `object-contain` is used instead of `object-cover` to avoid cropping architectural floor plan blueprints. `mix-blend-multiply` removes white backgrounds on transparent PNGs.

### 3.3 Living Room Section

Rendered when `galleryImages.filter(img => img.category === 'living').length > 0`.

| Element | Spec |
|---------|------|
| Hero image | `aspect-video` container, `object-cover` |
| Caption | `text-sm text-gray-500` below hero |
| Remaining images | 2–3 column grid, `aspect-[4/3]`, hover scale |

### 3.4 Dynamic Category Sections

All categories in `data.galleryCategories` except `plan` and `living` are rendered using the generic `renderSection()` helper.

| Element | Spec |
|---------|------|
| Section heading | `text-xl font-bold text-gray-900`, `mb-4` |
| Image grid | `grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4` |
| Each image | `aspect-[4/3]`, `rounded-sm`, `object-cover`, hover scale |
| Caption | `text-sm text-gray-600 font-medium` below each image |
| Empty category | Silently skipped (not rendered) |

**Category order:** Follows the order of `data.galleryCategories` array.

### 3.5 Uncategorized Photos Section

Renders images whose `category` value does not match any known `galleryCategories` ID. Shows as a section titled "Uncategorized Photos" using the same grid layout. This is a safety catch-all for orphaned images.

---

## 4. Layout & Spacing

| Property | Value |
|----------|-------|
| Page background | `bg-white` |
| Content max-width | `max-w-5xl mx-auto` |
| Horizontal padding | `px-4 sm:px-6` |
| Top padding | `pt-16` (accounts for fixed header height) |
| Bottom padding | `pb-16` |
| Section bottom margin | `mb-8` (generic), `mb-10` (special sections) |

---

## 5. Image Loading

| Image | Loading Strategy |
|-------|----------------|
| All images | `loading="lazy"` (all images are below fold; page is long-scroll) |
| Floor plan hero | `loading="lazy"` + `object-contain` |

---

## 6. States

| State | Display |
|-------|---------|
| Category has no images | Section is completely omitted |
| All categories empty | Page shows only the fixed header; no content sections |
| Image URL is invalid/broken | Native browser broken-image placeholder |

---

## 7. Responsive Behavior

| Breakpoint | Image Grid |
|------------|-----------|
| Mobile (< `md`) | 1 column for generic sections; 2 columns for extra floor plan images |
| Tablet (`md`) | 2 columns |
| Desktop (`lg`) | 3 columns |

---

## 8. Navigation Flows

```
SCR-03 Photo Tour
  │
  └── Click ← Back button → navigate(-1) → typically SCR-02 Property Homepage
```

---

## V2 Change Request Addendum (2026-05-03)

### Backend + DB Integration

- Gallery metadata must be fetched through `GET /api/v1/properties/{propertyId}/gallery`.
- Image upload/delete/reorder actions must use authenticated backend endpoints with audit logging.
- Storage backend should be object storage (S3-compatible), referenced by URL in PostgreSQL.

### Role Updates

- Host can manage gallery only for assigned properties.
- Admin can manage gallery for all properties.
