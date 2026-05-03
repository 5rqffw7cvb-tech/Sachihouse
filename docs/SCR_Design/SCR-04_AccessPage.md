# Screen Design Document — SCR-04: Access & Transport Guide Page

**Screen ID:** SCR-04  
**Screen Name:** Access & Transport Guide  
**Route:** `/{id}/access`  
**File:** `pages/AccessPage.tsx`  
**Layout Wrapper:** `Layout` (property nav + footer)

---

## 1. Screen Overview

Helps guests plan their journey to the property. Provides a map, a video walking guide, and structured text blocks for train directions, airport transfers, and check-in procedures.

---

## 2. Wireframe — Desktop

```
┌──────────────────────────────────────────────────────────────┐
│  PROPERTY NAV BAR                                            │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  HEADER                                                      │
│  [centered]                                                  │
│  <data.titles.access>                                        │
│  <data.titles.accessSubtitle>                                │
│                                                              │
│  MAP CARD  (rounded-2xl, shadow)                             │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                                                        │  │
│  │  Google Maps iframe  (h-[500px] on desktop)            │  │
│  │  [greyscale → full-color on hover]                     │  │
│  │                                                        │  │
│  │  📍 <address>  (white badge, bottom-left, desktop only)│  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  YOUTUBE VIDEO CARD  (rounded-2xl, shown if videoId exists) │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  HEADER BAR                                            │  │
│  │  [▶ red box]  Video Walking Guide                      │  │
│  │               Route from nearest station               │  │
│  │                           [↗ Open in YouTube]          │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │  aspect-video YouTube iframe (edge-to-edge)            │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  TRANSPORT INFO GRID  (3 columns on md+, 1 on mobile)       │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐│
│  │  🚆 By Train     │  │  ✈ From Airports │  │  ⏰ Check-in││
│  │  (blue icon bg)  │  │  (green icon bg) │  │  (amber bg) ││
│  │                  │  │                  │  │              ││
│  │  <train text>    │  │  <airport text>  │  │  <checkin>  ││
│  │  (pre-line)      │  │  (pre-line)      │  │  (pre-line) ││
│  └──────────────────┘  └──────────────────┘  └──────────────┘│
│                                                              │
├──────────────────────────────────────────────────────────────┤
│  FOOTER                                                      │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. Wireframe — Mobile

```
┌─────────────────────────┐
│  PROPERTY NAV BAR       │
├─────────────────────────┤
│  <titles.access>        │
│  <titles.accessSubtitle>│
│  [centered]             │
├─────────────────────────┤
│  MAP                    │
│ ┌─────────────────────┐ │
│ │  Google Maps iframe │ │
│ │  (h-[250px] mobile) │ │
│ │  [greyscale → color]│ │
│ └─────────────────────┘ │
│  (no address badge)     │
├─────────────────────────┤
│  YOUTUBE VIDEO          │
│ ┌─────────────────────┐ │
│ │ [▶] Walking Guide   │ │
│ │ [↗ Open YouTube]    │ │
│ │ aspect-video iframe │ │
│ └─────────────────────┘ │
├─────────────────────────┤
│  TRANSPORT CARDS (1col) │
│ ┌─────────────────────┐ │
│ │ 🚆 By Train         │ │
│ │ <train text>        │ │
│ └─────────────────────┘ │
│ ┌─────────────────────┐ │
│ │ ✈ From Airports     │ │
│ │ <airport text>      │ │
│ └─────────────────────┘ │
│ ┌─────────────────────┐ │
│ │ ⏰ Check-in Details │ │
│ │ <checkin text>      │ │
│ └─────────────────────┘ │
├─────────────────────────┤
│  MOBILE BOTTOM NAV      │
└─────────────────────────┘
```

---

## 4. UI Components

### 4.1 Page Header

| Element | Type | Source |
|---------|------|--------|
| Page title (H1) | Centered `text-3xl font-bold` | `data.titles.access` |
| Subtitle | Centered paragraph | `data.titles.accessSubtitle` |

### 4.2 Map Card

| Element | Spec |
|---------|------|
| Container | `bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden` |
| Height | `h-[250px]` mobile / `h-[500px]` desktop (`md:`) |
| iframe src | `data.mapEmbedUrl` |
| Filter | `grayscale` by default; `grayscale-0` on hover (`transition-all duration-500`) |
| Address badge | `bg-white/90 backdrop-blur px-4 py-2 rounded-lg`, shows `data.address` with `MapPin` icon; **hidden on mobile** (`hidden md:block`) |
| iframe attributes | `allowFullScreen`, `loading="lazy"`, `referrerPolicy="no-referrer-when-downgrade"` |

### 4.3 YouTube Video Card

Conditionally rendered: `videoId !== null` (extracted from `data.accessInfo?.youtubeGuideUrl`).

**Supported YouTube URL formats:**
- `youtu.be/{id}`
- `youtube.com/watch?v={id}`
- `youtube.com/embed/{id}`
- `youtube.com/shorts/{id}`
- `youtube.com/u/w/{id}`

| Zone | Element | Spec |
|------|---------|------|
| Header bar | Container | `px-5 py-4 border-b border-gray-100 flex items-center justify-between` |
| Header bar | YouTube icon box | 40×40px, `bg-red-600`, rounded-lg, `Youtube` Lucide icon (white) |
| Header bar | Title | "Video Walking Guide" (bold) + subtitle "Route from nearest station" |
| Header bar | "Open in YouTube" link | Blue pill button, opens `videoUrl` in new tab |
| Video player | iframe container | `aspect-video w-full bg-black relative` |
| Video iframe | src | `https://www.youtube-nocookie.com/embed/{videoId}?rel=0&modestbranding=1&playsinline=1` |
| Video iframe | attributes | `allowFullScreen`, `loading="lazy"`, `referrerPolicy="strict-origin-when-cross-origin"` |

### 4.4 Transport Info Cards

Three cards in a `grid-cols-1 md:grid-cols-3 gap-8` grid.

| Card | Icon | Icon Color | Heading | Content Source |
|------|------|-----------|---------|---------------|
| By Train | `Train` | Blue (`bg-blue-100 text-blue-600`) | "By Train" | `data.accessInfo?.train` |
| From Airports | `Navigation` | Green (`bg-green-100 text-green-600`) | "From Airports" | `data.accessInfo?.airport` |
| Check-in Details | `Clock` | Amber (`bg-amber-100 text-amber-600`) | "Check-in Details" | `data.accessInfo?.checkIn` |

**Card layout:**
```
┌──────────────────────────────┐
│  [Icon circle 48×48]         │
│  Heading (lg, bold, gray-900)│
│  Content text                │
│  (text-sm, gray-600,         │
│   whitespace-pre-line,       │
│   leading-relaxed)           │
└──────────────────────────────┘
```

- Background: `bg-gray-50`
- Border: `border border-gray-100`
- Border-radius: `rounded-xl`
- Padding: `p-6`
- Fallback when empty: "No [section] information provided."

---

## 5. States

| State | Display |
|-------|---------|
| No YouTube URL configured | YouTube section is completely omitted |
| No train info | "No train information provided." in card body |
| No airport info | "No airport information provided." in card body |
| No check-in info | "No check-in details provided." in card body |
| Map URL invalid | iframe shows browser's default iframe error |

---

## 6. Responsive Behavior

| Element | Mobile | Desktop |
|---------|--------|---------|
| Map height | 250px | 500px |
| Address badge | Hidden | Visible (absolute, bottom-left of map) |
| YouTube header | Stacked (flex-col on small) | Row layout (sm:flex-row) |
| Transport grid | 1 column | 3 columns |

---

## 7. Navigation Flows

```
SCR-04 Access Page
  │
  ├── Property nav links → Other property pages (SCR-02, 05, 06, 07)
  ├── Back to Listings → SCR-01
  └── "Open in YouTube" → External YouTube (new tab)
```

---

## V2 Change Request Addendum (2026-05-03)

### Backend + DB Integration

- Access content (map/video/text blocks) must be sourced from `GET /api/v1/properties/{propertyId}/access`.
- Any content edits should be persisted via authenticated update endpoints.

### Role Updates

- Host edit permission is limited to assigned properties.
- Admin edit permission applies globally.
