# Screen Design Document — SCR-07: Guest Manual Page

**Screen ID:** SCR-07  
**Screen Name:** Guest Manual / Usage Guide  
**Route:** `/{id}/manual`  
**File:** `pages/ManualPage.tsx`  
**Layout Wrapper:** `Layout` (property nav + footer)

---

## 1. Screen Overview

An accordion-based FAQ/guide page that helps guests understand how to use the property's appliances and facilities. Guests can search for specific topics and expand individual accordion items to read detailed instructions with optional images.

---

## 2. Wireframe

```
┌──────────────────────────────────────────────────────────┐
│  PROPERTY NAV BAR                                        │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  HEADER ROW  [flex, space-between on md+]                │
│  ┌──────────────────────────┐  ┌──────────────────────┐  │
│  │ <data.titles.manual>     │  │  [🔍 Search guides..]│  │
│  │ <data.titles.manualSub>  │  └──────────────────────┘  │
│  └──────────────────────────┘                            │
│  (on mobile: stacked, full-width search input)           │
│                                                          │
│  ACCORDION ITEMS  (max-w-3xl, space-y-4)                │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  [📖 blue]  Wifi & Internet                  ▲  │   │  ← OPEN
│  │  ─────────────────────────────────────────────   │   │
│  │  [optional photo/image]                          │   │
│  │  Content text...                                 │   │
│  │  (whitespace-pre-line, leading-relaxed)          │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  [📖 gray]  Air Conditioner / Heater          ▼  │   │  ← CLOSED
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  [📖 gray]  Washing Machine                   ▼  │   │  ← CLOSED
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ... (one accordion per manual item)                     │
│                                                          │
│  EMPTY STATE  (shown when search has no matches)         │
│  ┌──────────────────────────────────────────────────┐   │
│  │  [center]  No guides found matching "query"       │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
├──────────────────────────────────────────────────────────┤
│  FOOTER                                                  │
└──────────────────────────────────────────────────────────┘
```

---

## 3. UI Components

### 3.1 Page Header

| Element | Platform | Source |
|---------|----------|--------|
| Title (H1) | `text-3xl font-bold text-gray-900` | `data.titles.manual` |
| Subtitle | `text-gray-500` | `data.titles.manualSubtitle` |

**Layout:** `flex-col md:flex-row md:items-center justify-between gap-6` — title on left, search on right on desktop; stacked on mobile.

### 3.2 Search Input

| Element | Spec |
|---------|------|
| Input field | Rounded-full pill shape, left `Search` icon |
| Placeholder | "Search guides..." |
| Width | `w-full md:w-64` |
| Behavior | Real-time `onChange` filtering of `data.manual[]` |
| Filter scope | Both `item.title` AND `item.content` (case-insensitive `.toLowerCase().includes()`) |
| State | Controlled by `search` state variable; not persisted on navigation |

### 3.3 Accordion Container

`space-y-4` vertical list of accordion cards. Filter applied: `filteredManual = data.manual.filter(...)`.

**Initial state:** First item (`data.manual[0]`) is open by default (`openId = data.manual[0]?.id`).

**Accordion behavior:** Only one item open at a time. Clicking an open item collapses it (sets `openId = null`). Clicking a different item opens it (sets `openId = item.id`).

### 3.4 Accordion Item — Collapsed State

```
┌───────────────────────────────────────────────────────┐
│  [📖 gray bg]  <item.title>  (font-bold, text-lg)   ▼ │
│  bg-white hover:bg-gray-50 transition-colors           │
└───────────────────────────────────────────────────────┘
```

| Element | Spec |
|---------|------|
| Trigger button | Full width, `flex items-center justify-between p-6 text-left` |
| Icon box | `p-2 rounded-lg bg-gray-100 text-gray-600` (collapsed) |
| Title | `font-bold text-gray-900 text-lg` |
| Chevron | `ChevronDown w-5 h-5 text-gray-400` |

### 3.5 Accordion Item — Expanded State

```
┌───────────────────────────────────────────────────────┐
│  [📖 blue bg]  <item.title>                         ▲ │
│  ───────────────────────────────────────────────────   │
│  [optional image: max-w-xl, max-h-[400px], rounded-lg]│
│  Content text (whitespace-pre-line, text-gray-600)     │
└───────────────────────────────────────────────────────┘
```

| Element | Spec |
|---------|------|
| Trigger button | `bg-white` (no hover — item is open) |
| Icon box | `bg-blue-100 text-blue-600` (expanded) |
| Chevron | `ChevronUp w-5 h-5 text-gray-400` |
| Panel container | `p-6 pt-0 bg-white border-t border-gray-100` |
| Optional image | `mt-6 mb-6 rounded-lg overflow-hidden border border-gray-100 shadow-sm bg-gray-50 max-w-xl`; `max-h-[400px] object-cover` |
| Content text | `text-gray-600 leading-relaxed whitespace-pre-line mt-4` |

**Conditional rendering:** Image is only rendered when `item.imageUrl` is truthy.

### 3.6 Empty State

Shown when `filteredManual.length === 0` (search returns no results).

```
┌────────────────────────────────────────────────────────┐
│  [center, py-12, bg-gray-50, rounded-xl, border-dashed]│
│  No guides found matching "{search}"                    │
└────────────────────────────────────────────────────────┘
```

---

## 4. Layout & Spacing

| Property | Value |
|----------|-------|
| Content max-width | `max-w-3xl mx-auto` |
| Horizontal padding | `px-3 sm:px-6 lg:px-8` |
| Vertical padding | `py-8` |
| Accordion item spacing | `space-y-4` |
| Accordion card style | `border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm hover:shadow-md` |

---

## 5. States

| State | Display |
|-------|---------|
| Initial load | First manual item auto-expanded |
| Search active with results | Filtered accordion list (may show fewer items) |
| Search active with no results | Empty state message with search term |
| Search cleared | Full list restored, open state preserved from before |
| No manual items configured | Empty `space-y-4` (no items, no empty state message) |

---

## 6. Responsive Behavior

| Element | Mobile | Desktop (`md+`) |
|---------|--------|-----------------|
| Header + search | Stacked (column) | Side by side (row) |
| Search input width | Full width | Fixed 256px (`md:w-64`) |
| Accordion items | Full width | Full width (constrained to max-w-3xl) |
| Item image | Full width, max 400px tall | Max-w-xl |

---

## 7. Navigation Flows

```
SCR-07 Manual Page
  │
  └── Property nav links → SCR-02, 04, 05, 06
  └── Back to Listings → SCR-01
```

---

## V2 Change Request Addendum (2026-05-03)

### Backend + DB Integration

- Manual items must be served by backend API with support for pagination/search when datasets grow.
- Manual create/update/delete must be secured by RBAC policy.

### Role Updates

- Host can manage manual content for assigned properties.
- Admin can manage manual content for all properties.
