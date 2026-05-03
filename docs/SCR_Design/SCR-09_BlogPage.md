# Screen Design Document — SCR-09: Blog Listing Page

**Screen ID:** SCR-09  
**Screen Name:** Blog Listing  
**Route:** `/blog`  
**File:** `pages/BlogPage.tsx`  
**Layout Wrapper:** `GlobalLayout` (TopNavBar + Footer)

---

## 1. Screen Overview

Platform-level blog listing page. Shows a featured hero post at the top (when no filter is active), followed by a paginated grid of post cards. Includes a sticky sidebar on large screens with categories and recent posts. Supports URL-based category filtering and search queries.

---

## 2. Wireframe — Desktop (No Filter)

```
┌──────────────────────────────────────────────────────────────┐
│  TOP NAV BAR (GlobalLayout)                                  │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  PAGE HEADER                                                 │
│  <Blog Title>      [🔍 Search box]                          │
│  [Category pills: All | Sightseeing | Tips | ...]           │
│                                                              │
│  FEATURED POST  (hidden when filter/search active)          │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                                                       │  │
│  │  [aspect-[21/9] hero image]                           │  │
│  │  ┌──────────────┐                                     │  │
│  │  │ CATEGORY BADGE│  (top-left overlay)                │  │
│  │  └──────────────┘                                     │  │
│  │                                                       │  │
│  │  TITLE  (text-3xl or 28px, max-w-2xl)                 │  │
│  │  EXCERPT  (line-clamp-3, text-gray-600)               │  │
│  │  DATE    (text-sm text-gray-500)                      │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                              │
│  MAIN AREA   ┌── 2/3 ──────────────────┐  ┌─ 1/3 sidebar ─┐│
│              │                         │  │               ││
│              │  REGULAR POSTS GRID     │  │  BlogSidebar  ││
│              │  ┌───────┐  ┌───────┐  │  │  Categories   ││
│              │  │ 4:3   │  │ 4:3   │  │  │  Recent Posts ││
│              │  │ img   │  │ img   │  │  │               ││
│              │  │       │  │       │  │  │               ││
│              │  │ badge │  │ badge │  │  │               ││
│              │  │ title │  │ title │  │  └───────────────┘│
│              │  │ exrpt │  │ exrpt │  │                   │
│              │  │ date  │  │ date  │  │                   │
│              │  └───────┘  └───────┘  │                   │
│              │  ...                   │                   │
│              │                        │                   │
│              │  PAGINATION            │                   │
│              │  [←] [1] [2] [3] [→]  │                   │
│              └────────────────────────┘                   │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│  FOOTER                                                      │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. Wireframe — Mobile

```
┌─────────────────────────┐
│  TOP NAV BAR            │
├─────────────────────────┤
│  <Blog Title>           │
│  [🔍 Search input]      │
│  [Category pills scroll]│
├─────────────────────────┤
│  FEATURED POST (mobile) │
│ ┌───────┐               │
│ │ 120px │  TITLE        │
│ │ thumb │  excerpt ...  │
│ │       │  DATE         │
│ └───────┘               │
├─────────────────────────┤
│  POST CARDS (1 col)     │
│ ┌────────────────────┐  │
│ │ ┌────┐  TITLE      │  │
│ │ │120 │  excerpt    │  │
│ │ │ px │  DATE       │  │
│ │ └────┘             │  │
│ └────────────────────┘  │
│ ┌────────────────────┐  │
│ │ ┌────┐  TITLE      │  │
│ │ │120 │  excerpt    │  │
│ │ │ px │  DATE       │  │
│ │ └────┘             │  │
│ └────────────────────┘  │
│  [← ] [1][2][3] [ →]   │
└─────────────────────────┘
```

---

## 4. UI Components

### 4.1 Page Header

| Element | Spec |
|---------|------|
| Title | "Our Travel Blog" (or translated) — `text-3xl font-bold` |
| Subtitle | Tagline from data or static |
| Search box | `input` with search icon, filters `q` URL param |
| Category pills | Horizontal scroll row; "All" + one per distinct category in posts |
| Active category | Blue filled pill; inactive = outlined gray |

**URL integration:**
- `?category=sightseeing` — pre-selects that category pill
- `?q=tokyo` — pre-fills search input
- Both params persist in URL, allow back/forward navigation and link-sharing

### 4.2 Featured Post Card (Desktop)

Shown only when `!category && !q` (no active filter/search).

| Element | Spec |
|---------|------|
| Container | `cursor-pointer rounded-2xl overflow-hidden shadow-md hover:shadow-xl transition-shadow` |
| Image | `aspect-[21/9]` object-cover hero, `loading="lazy"` |
| Category badge | Absolute top-left overlay, colored background based on category |
| Title | `text-3xl font-bold text-gray-900 max-w-2xl leading-tight` |
| Excerpt | `text-gray-600 leading-relaxed line-clamp-3 max-w-2xl` |
| Date | `text-gray-500 text-sm` formatted date |
| Featured badge | "FEATURED" label in metadata display |

### 4.3 Featured Post Card (Mobile)

Horizontal layout at the top of the list on mobile.

| Element | Spec |
|---------|------|
| Container | `flex gap-3` |
| Thumbnail | `w-[120px] h-[120px] rounded-xl object-cover flex-shrink-0` |
| Text area | Title + excerpt (line-clamp-2) + date |

### 4.4 Regular Post Card (Desktop)

| Element | Spec |
|---------|------|
| Container | `group cursor-pointer rounded-2xl overflow-hidden border border-gray-100 shadow-sm hover:shadow-lg` |
| Image | `aspect-[4/3]` object-cover |
| Category badge | Colored tag (top of content area) |
| Title | `font-bold text-lg text-gray-900 leading-snug group-hover:text-blue-600` |
| Excerpt | `text-gray-500 text-sm line-clamp-2` |
| Date | `text-gray-400 text-xs` |

### 4.5 Regular Post Card (Mobile)

| Element | Spec |
|---------|------|
| Container | `flex gap-3 py-4 border-b border-gray-100` |
| Thumbnail | `w-[120px] h-[120px] rounded-xl object-cover flex-shrink-0` |
| Text area | Category badge (xs) + title + date |
| Grid override | On mobile: `grid-cols-1` (single column list) |

### 4.6 Pagination

| Element | Spec |
|---------|------|
| Previous button | `ChevronLeft` icon, disabled on page 1 |
| Page number buttons | Circle buttons; active = `bg-blue-600 text-white`; inactive = `hover:bg-gray-100` |
| Next button | `ChevronRight` icon, disabled on last page |
| Items per page | 6 posts per page |
| Total pages | Calculated from `filteredPosts.length / 6` |

### 4.7 BlogSidebar (Desktop Only)

Rendered only on `lg+` via sidebar column.

| Zone | Content |
|------|---------|
| Categories | List of category links with post count |
| Recent Posts | Thumbnails + titles of latest 5 posts |
| Navigation | Click updates `?category=` URL param or navigates to post |

---

## 5. States

| State | Display |
|-------|---------|
| No filter active | Featured post shown; full grid shown |
| Category filter active | Featured post hidden; grid filtered by category |
| Search filter active | Featured post hidden; grid filtered by search term |
| No results | "No posts found" empty state message |
| Single page | Pagination not shown |
| Multi-page | Pagination shown |

---

## 6. Responsive Behavior

| Element | Mobile | Desktop (`lg+`) |
|---------|--------|-----------------|
| Featured post layout | Horizontal thumbnail + text | Full-width 21:9 hero |
| Post grid | 1 column | 2 columns (regular posts) |
| Post card layout | Horizontal (120px thumb) | Vertical (4:3 image on top) |
| BlogSidebar | Hidden | Visible right column |
| Category pills | Horizontally scrollable row | Wrap or fixed row |

---

## 7. Navigation Flows

```
SCR-09 Blog Listing
  │
  ├── Click post card → SCR-10 Blog Post Detail (/blog/:id)
  ├── Click category pill → filters in-place (?category=X)
  ├── Type in search → filters in-place (?q=X)
  ├── BlogSidebar category → filters (?category=X)
  ├── BlogSidebar recent post → SCR-10 Blog Post Detail
  ├── Pagination → same page (increments page state)
  └── TopNavBar home → SCR-01 ListingsPage
```

---

## 8. Dynamic `<head>` (react-helmet-async)

| Condition | `<title>` |
|-----------|----------|
| No filter | "Our Travel Blog – SachiHouse78" |
| Category filter | "{Category} – Our Travel Blog" |
| Search filter | "Search: {q} – Our Travel Blog" |

---

## V2 Change Request Addendum (2026-05-03)

### Backend + DB Integration

- Blog listing/search/category filters must be served by backend API with pagination.
- Query parameters should map to indexed fields in PostgreSQL for stable performance.

### Role Updates

- Guest has public read access.
- Host may be granted author rights by policy.
- Admin has full publication control.
