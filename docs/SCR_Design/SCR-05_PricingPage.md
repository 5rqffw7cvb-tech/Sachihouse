# Screen Design Document — SCR-05: Pricing & Availability Page

**Screen ID:** SCR-05  
**Screen Name:** Pricing & Availability  
**Route:** `/{id}/pricing`  
**File:** `pages/PricingPage.tsx`  
**Layout Wrapper:** `Layout` (property nav + footer)

---

## 1. Screen Overview

Combines two main elements: a rate table with discount info on the left, and a 2-month availability calendar on the right. The BookingWidget (price simulator) appears at the top on mobile, and is embedded in the sidebar on desktop within this page context.

---

## 2. Wireframe — Desktop

```
┌──────────────────────────────────────────────────────────────┐
│  PROPERTY NAV BAR                                            │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  HEADER                                                      │
│  <data.titles.pricing>                                       │
│  <data.titles.pricingSubtitle>                               │
│                                                              │
│  MAIN GRID  [7 cols left | 5 cols right]                     │
│  ┌──────────────────────────┐  ┌──────────────────────────┐  │
│  │  LEFT COLUMN (lg:col-7)  │  │  RIGHT COLUMN (lg:col-5) │  │
│  │                          │  │                          │  │
│  │  STANDARD RATES TABLE    │  │  AVAILABILITY            │  │
│  │  ┌────────────────────┐  │  │  Availability  ● Blocked │  │
│  │  │ [Tag] Standard Rates│  │  │               ● Available│ │
│  │  │────────────────────│  │  │                          │  │
│  │  │ Guests|Price|Fee   │  │  │  [Month Year - Calendar] │  │
│  │  │ 1 guest|¥X,XXX|¥XX │  │  │  Su Mo Tu We Th Fr Sa   │  │
│  │  │ 2 guests|¥X,XXX|¥XX│  │  │   1  2  3  4  5  6  7   │  │
│  │  │ ...                │  │  │   8  9 10 11 12 13 14    │  │
│  │  └────────────────────┘  │  │  (blocked: strikethrough)│  │
│  │                          │  │  (available: hover=blue) │  │
│  │  DISCOUNT CARDS (2-col)  │  │                          │  │
│  │  ┌────────┐ ┌──────────┐ │  │  [Month Year + 1]        │  │
│  │  │✨ Long  │ │ℹ Child   │ │  │  Su Mo Tu We Th Fr Sa   │  │
│  │  │Stay N%  │ │Discount  │ │  │  ...                     │  │
│  │  │off for  │ │N% off age│ │  │                          │  │
│  │  │N+ nights│ │N-N       │ │  │  [← Prev Month] [Next→] │  │
│  │  └────────┘ └──────────┘ │  │                          │  │
│  │                          │  └──────────────────────────┘  │
│  └──────────────────────────┘                                │
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
│  <titles.pricing>       │
│  <titles.pricingSubtitle│
├─────────────────────────┤
│  BOOKING WIDGET (block) │
│  (mobile: shown here,   │
│   class: block lg:hidden│
│  [dates][guests][price] │
├─────────────────────────┤
│  STANDARD RATES TABLE   │
│ ┌─────────────────────┐ │
│ │ Guests|Price|Fee    │ │
│ │ 1 |¥X,XXX| ¥X,XXX  │ │
│ │ 2 |¥X,XXX| ¥X,XXX  │ │
│ └─────────────────────┘ │
│ ┌─────────┐ ┌─────────┐ │
│ │✨ Long  │ │ℹ Child  │ │
│ │ Stay    │ │ Discount│ │
│ └─────────┘ └─────────┘ │
├─────────────────────────┤
│  AVAILABILITY           │
│  ● Blocked ● Available  │
│  [Month Calendar]       │
│  [Month+1 Calendar]     │
│  [← Prev] [Next →]      │
├─────────────────────────┤
│  MOBILE BOTTOM NAV      │
└─────────────────────────┘
```

---

## 4. UI Components

### 4.1 Page Header

| Element | Source |
|---------|--------|
| Title (H1, centered) | `data.titles.pricing` |
| Subtitle (centered) | `data.titles.pricingSubtitle` |

### 4.2 BookingWidget (Mobile Only)

Rendered with `class="block lg:hidden"`. Displays the full price simulator widget inline in the mobile layout between the page header and the pricing table. See Section 4.6 for widget specification.

### 4.3 Standard Rates Table

| Element | Detail |
|---------|--------|
| Container | `bg-white rounded-3xl border border-gray-100 shadow-xl` |
| Header | Gradient `from-blue-50 to-white` with `Tag` Lucide icon, title "Standard Rates", subtitle text |
| Table columns | **Guests** / **Price / Guest** / **Cleaning Fee** (right-aligned) |
| Table body | One row per rate tier from `data.pricing.rates[]` |
| Each row | Guest count label, `¥N,NNN / night`, cleaning fee from `getCleaningFee(guests)` lookup |
| Row hover | `hover:bg-blue-50/30 transition-colors` |
| Anchor | `id="rules"` on container — supports `/#/id/pricing#rules` deep-link scroll |

### 4.4 Discount Info Cards

Displayed in a `grid-cols-1 md:grid-cols-2 gap-4` row below the rates table (inside the same card, `bg-gray-50 border-t`).

| Card | Icon | Title | Content |
|------|------|-------|---------|
| Long Stay Discount | `Sparkles` (blue) | "Long Stay Discount" | "{N}% OFF room rate for stays of {N}+ nights." |
| Children Discount | `Info` (blue) | "Children Discount" | "Children aged {min}-{max} get {N}% OFF." |

### 4.5 Availability Calendar

**Layout:** `lg:col-span-5`. Two months rendered vertically.

**Calendar Legend (header row):**

| Symbol | Meaning |
|--------|---------|
| Grey dot | Blocked |
| Blue dot | Available |

**Calendar Component (per month):**

| Element | Detail |
|---------|--------|
| Container | `bg-white p-6 rounded-2xl border border-gray-100 shadow-sm` |
| Month heading | `text-center font-bold text-gray-900 text-lg`, formatted as "MMMM yyyy" |
| Day-name row | 7 columns: Su Mo Tu We Th Fr Sa (uppercase, `text-xs`, `text-gray-400`) |
| Day cells | `grid-cols-7 gap-2` |
| Padding cells | Empty divs for days before the 1st |
| Available day | White bg, hover: `bg-blue-600 text-white hover:scale-105`, `ring-1 ring-gray-100` |
| Blocked day | `bg-gray-50 text-gray-300 line-through cursor-not-allowed` |
| Day cell size | `aspect-square`, `rounded-lg` |

**Navigation buttons:**

| Button | Action |
|--------|--------|
| "Previous Month" | `setCurrentMonth(addMonths(currentMonth, -1))` |
| "Next Month" | `setCurrentMonth(addMonths(currentMonth, 1))` |

Both buttons: `px-5 py-2.5 bg-white border border-gray-200 rounded-xl font-semibold`.

---

## 5. Hash Scroll Behavior

When navigating to `/{id}/pricing#rules`, the page auto-scrolls the rates table into view using `element.scrollIntoView({ behavior: 'smooth' })`. This is triggered by `useEffect` watching `location.hash`.

---

## 6. States

| State | Display |
|-------|---------|
| No blocked dates (iCal not synced) | All calendar days appear as available (blue hover) |
| Blocked date | Grey background, strikethrough text, `cursor-not-allowed` |
| No rate tiers configured | Empty table body |

---

## 7. Responsive Behavior

| Element | Mobile | Desktop (`lg`) |
|---------|--------|----------------|
| BookingWidget | Shown inline (top of page) | Hidden (shown in Layout sidebar) |
| Main grid | Single column | 7+5 column split |
| Discount cards | 1 column | 2 columns |

---

## 8. Navigation Flows

```
SCR-05 Pricing Page
  │
  ├── Property nav links → SCR-02, 04, 06, 07
  ├── Back to Listings → SCR-01
  └── BookingWidget "Send Inquiry" → mailto: (device email client)
```

---

## V2 Change Request Addendum (2026-05-03)

### Backend + DB Integration

- Pricing tiers should be fetched from backend (`GET /api/v1/properties/{propertyId}/pricing`).
- Optionally add backend-calculated pricing quote endpoint for consistency (`POST /api/v1/quotes`).
- Availability panel should read from backend date blocks derived from iCal sync worker.

### Role Updates

- Host can edit pricing config only for assigned properties.
- Admin can edit pricing config for all properties.
