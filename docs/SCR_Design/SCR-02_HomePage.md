# Screen Design Document — SCR-02: Property Homepage

**Screen ID:** SCR-02  
**Screen Name:** Property Homepage  
**Route:** `/{id}/`  
**File:** `pages/HomePage.tsx`  
**Layout Wrapper:** `Layout` (property nav + footer)

---

## 1. Screen Overview

The primary guest-facing page for a single property. Equivalent to an OTA listing page. Combines the photo gallery, property details, sleeping arrangements, amenities, booking widget, location map, and host profile into one scrollable page.

---

## 2. Wireframe — Desktop

```
┌──────────────────────────────────────────────────────────────────┐
│  PROPERTY NAV BAR                                                │
│  [← Back to Listings] [Property Name] [Home|Access|Price|Rules|Manual] [EN▾] [⚙ Admin] │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  PROPERTY TITLE                                                  │
│  <name>                                                          │
│  <address>  •  <subtitle>                                        │
│                                                                  │
│  DESKTOP HERO GRID  (h-[480px], rounded-2xl)                     │
│  ┌───────────────────┬──────────┬──────────┐                    │
│  │                   │ img[1]   │ img[3]   │                    │
│  │    img[0]         ├──────────┼──────────┤                    │
│  │   (2 cols)        │ img[2]   │ img[4]   │                    │
│  └───────────────────┴──────────┴──────────┘                    │
│                              [⊞ Show all photos] (bottom-right) │
│                                                                  │
│  ┌──────────────────────────────┐  ┌──────────────────────┐     │
│  │  MAIN CONTENT (2/3 cols)     │  │  BOOKING WIDGET      │     │
│  │                              │  │  (1/3 col, sticky)   │     │
│  │  HOST INFO                   │  │  [Check-in ▾]        │     │
│  │  [avatar+badge]  Hosted by X │  │  [Check-out ▾]       │     │
│  │  ★ Airbnb Superhost since YY │  │  Adults - [N] +      │     │
│  │  ────────────────────────── │  │  Children - [N] +    │     │
│  │                              │  │  Infants - [N] +     │     │
│  │  HIGHLIGHTS (3 rows)         │  │  ─────────────────── │     │
│  │  [Icon] Title                │  │  ¥XX,XXX / night     │     │
│  │         Description          │  │  [See breakdown ▾]   │     │
│  │  ────────────────────────── │  │  [Send Inquiry →]    │     │
│  │                              │  └──────────────────────┘     │
│  │  ABOUT  (truncated)          │                               │
│  │  <description text...>       │                               │
│  │  [Show more ›]               │                               │
│  │  ────────────────────────── │                               │
│  │                              │                               │
│  │  WHERE YOU'LL SLEEP          │                               │
│  │  ◀ [RoomCard][RoomCard] ▶   │                               │
│  │  ────────────────────────── │                               │
│  │                              │                               │
│  │  AMENITIES                   │                               │
│  │  [Icon] WiFi  [Icon] TV      │                               │
│  │  [Icon] Kitchen  ...         │                               │
│  │  ────────────────────────── │                               │
│  │                              │                               │
│  │  PLATFORM LINKS              │                               │
│  │  [A] Airbnb  →               │                               │
│  │  [B] Booking.com  →          │                               │
│  │  [G] Agoda  →                │                               │
│  └──────────────────────────────┘                               │
├──────────────────────────────────────────────────────────────────┤
│  FOOTER                                                          │
└──────────────────────────────────────────────────────────────────┘
```

---

## 3. Wireframe — Mobile

```
┌─────────────────────────┐
│  MOBILE HERO SLIDER     │
│  [← img1 → img2 →] N/5 │
│  (swipeable, 250px tall)│
├─────────────────────────┤
│ <name>                  │
│ 📍 <address>            │
├─────────────────────────┤
│  HOST INFO              │
│  [avatar] Hosted by X   │
│  ★ Superhost since 20XX │
├─────────────────────────┤
│  HIGHLIGHTS             │
│  [Icon] Title           │
│         Description     │
├─────────────────────────┤
│  ABOUT                  │
│  <description (165px)>  │
│  [Show more ›]          │
├─────────────────────────┤
│  WHERE YOU'LL SLEEP     │
│  ← [RoomCard] →        │
├─────────────────────────┤
│  BOOKING WIDGET (inline)│
│  [dates][guests][price] │
├─────────────────────────┤
│  PLATFORM LINKS         │
│  [A] Airbnb  →          │
│  [B] Booking.com  →     │
├─────────────────────────┤
│  AMENITIES              │
│  [Icon] WiFi            │
│  [Icon] TV              │
├─────────────────────────┤
│  MOBILE BOTTOM NAV      │
│ [🏠][🚪][💰][📜][📖]   │
└─────────────────────────┘
```

---

## 4. UI Sections & Components

### 4.1 Hero Gallery

| Platform | Layout | Behavior |
|----------|--------|---------|
| Desktop | 4-column grid, 480px tall. Left cell spans 2 cols (main image). Right: 2 columns × 2 rows of thumbnails. | Click any image → navigates to `/{id}/photos` |
| Mobile | Horizontal scroll snap slider, 250px tall. Auto-advances every 3.5s. Pauses on touch. | Tap → navigates to `/{id}/photos` |

- Images sourced from `galleryImages` where `showOnHome: true` (up to 5). Falls back to placeholder if none.
- "Show all photos" button (bottom-right of desktop grid): navigates to photo tour.
- Image counter badge (bottom-right of mobile slider): `N / 5`.

### 4.2 Host Info Bar

| Element | Source |
|---------|--------|
| Avatar (80×80 rounded) | `data.hostImageUrl` |
| Superhost medal icon (bottom-right of avatar) | Shown when `data.isSuperhost === true` |
| Heading | "Hosted by {data.hostName}" |
| Superhost label | Links to `data.social.airbnbUrl` if configured; "Airbnb Superhost" with medal icon |
| "Superhost since" | `data.superhostSince` |

### 4.3 Highlights

Up to 3 highlight items displayed as a vertical list of icon + title + description rows (no card borders). Icons mapped from `item.icon` string to Lucide icon components.

### 4.4 Description (About)

- Heading: `data.titles.about` (English) or `t('nav_home')` (other languages).
- Default collapsed height: `max-h-[165px]` with a white gradient fade-out overlay.
- "Show more / Show less" toggle button with chevron icon. Full height when expanded.

### 4.5 Sleeping Arrangements (Room Carousel)

Horizontal scroll carousel of room cards. Scroll buttons (`◀` `▶`) appear on hover (desktop only, hidden on mobile).

**Room Card:**

| Zone | Element |
|------|---------|
| Image | `room.imageUrl`, 208px tall, full cover, scales on hover |
| Hover overlay | "See Photos" pill appears bottom-right |
| Content | `room.title` (bold), `room.description` (with BedDouble icon) |
| Click action | Opens `LightboxGallery` for that room |

### 4.6 Lightbox Gallery (Room Photos)

Full-screen modal overlay. Triggered from room card click.

| Element | Detail |
|---------|--------|
| Header | "N / Total • Room Title" counter + × close button |
| Main image | `object-contain`, centered, transitions |
| Navigation arrows | Left/Right buttons (desktop only, hidden on mobile) |
| Thumbnail strip | Bottom strip with ring highlight on active; scrollable |
| Keyboard | `←`/`→` for prev/next; `Escape` to close |

### 4.7 Amenities Grid

- 2-column grid (`sm:grid-cols-2`).
- Each item: Lucide icon + amenity name text.
- Icon mapping: `AMENITY_ICONS` record in component; falls back to `Wifi`.

### 4.8 Platform Booking Links (PlatformButtons)

Shown only if URL is configured. Each button:
- Colored square icon (first letter of platform name, colored bg).
- Platform name + "Book on" micro-label.
- External link icon (right side).
- Opens in new tab.

**Desktop placement:** Inside the sticky Booking Widget column (below widget).  
**Mobile placement:** Below BookingWidget inline section, above amenities.

### 4.9 Booking Widget (Sidebar)

- **Desktop:** Sticky `top-6` in right column (1/3 width).
- **Mobile:** Rendered inline in the main content column between sleeping arrangements and platform links.
- See SCR-05 (PricingPage) for full BookingWidget specification.

---

## 5. States

| State | Display |
|-------|---------|
| No sleeping arrangements | "No sleeping arrangement details available." placeholder in grey box |
| No gallery images | Placeholder image repeated 5 times |
| Description collapsed | Max 165px visible, gradient fade, "Show more" button |
| Description expanded | Full text visible, "Show less" button |
| Lightbox open | Full-screen overlay, rest of page beneath it |

---

## 6. Responsive Behavior

| Breakpoint | Hero | Booking Widget | Platform Links |
|------------|------|---------------|---------------|
| Mobile (`< md`) | Swipe slider 250px | Inline (between rooms and amenities) | Below BookingWidget |
| Desktop (`≥ md`) | 4-col photo grid 480px | Sticky right column | Hidden on desktop (shown via BookingWidget column) |

---

## 7. Navigation Flows

```
SCR-02 Property Homepage
  │
  ├── Click hero / "Show all photos" → SCR-03 Photo Tour
  ├── Click room card → Lightbox overlay (in-page)
  ├── Click nav: Access → SCR-04 Access Page
  ├── Click nav: Pricing → SCR-05 Pricing Page
  ├── Click nav: Rules → SCR-06 Rules Page
  ├── Click nav: Manual → SCR-07 Manual Page
  ├── Click ← Back to Listings → SCR-01 Listings
  └── Click Airbnb/Booking/Agoda → External OTA (new tab)
```

---

## V2 Change Request Addendum (2026-05-03)

### Backend + DB Integration

- Property detail must come from `GET /api/v1/properties/{propertyId}`.
- Editable modules (for authenticated roles) must persist via PATCH API endpoints.
- Availability summary should use normalized backend response, not direct client-side DB access.

### Role Updates

- Host can edit only if assigned to this property.
- Admin can edit any property.
- Guest remains read-only.
