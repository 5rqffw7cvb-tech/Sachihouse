# Screen Design Document — SCR-08: BookingWidget (Price Simulator)

**Screen ID:** SCR-08  
**Screen Name:** Booking Widget / Price Simulator  
**Component File:** `components/BookingWidget.tsx`  
**Embedded In:** SCR-02 (Property Homepage — sticky sidebar/inline), SCR-05 (Pricing Page — mobile only)

---

## 1. Screen Overview

The BookingWidget is not a standalone page but a key interactive component that appears prominently on both the homepage and pricing page. It functions as a 2-step date picker + guest counter + price calculator + email inquiry launcher.

---

## 2. Wireframe — Default State

```
┌──────────────────────────────────────────┐
│  BOOKING WIDGET                          │
│  (rounded-3xl, shadow-xl, border)        │
│                                          │
│  ┌──────────────────────────────────┐    │
│  │  Check-in        Check-out       │    │
│  │  [📅 Apr 30]     [📅 May 3 ]    │    │
│  │  ──────────────────────────────  │    │
│  │  [CALENDAR POPOVER (see below)]  │    │
│  └──────────────────────────────────┘    │
│                                          │
│  GUEST SELECTOR                          │
│  Adults (age 11+)                        │
│  [─]  2  [+]                             │
│  ─────────────────────────────────────   │
│  Children (age 3-10)   N% OFF            │
│  [─]  0  [+]                             │
│  ─────────────────────────────────────   │
│  Infants (under 3)     Free              │
│  [─]  0  [+]                             │
│                                          │
│  PRICE RESULT  (shown when valid)        │
│  ─────────────────────────────────────   │
│  ¥ 32,400  /  3 nights                  │
│  [▼ See how price is calculated]         │
│                                          │
│  BREAKDOWN (expanded)                    │
│  Price / guest / night    ¥3,600         │
│  Adults (2 × ¥3,600 × 3) ¥21,600        │
│  Children (N% off)        ¥X,XXX         │
│  Infants                  Free           │
│  Subtotal                 ¥X,XXX         │
│  Long stay discount       -¥X,XXX        │
│  Cleaning fee             ¥X,XXX         │
│  ─────────────────────────────────────   │
│  Estimate Total           ¥X,XXX         │
│                                          │
│  [→  Send Booking Inquiry]               │
│  Opens your email app                    │
└──────────────────────────────────────────┘
```

---

## 3. Wireframe — Calendar Popover

```
┌──────────────────────────────────────────┐
│  CALENDAR POPOVER (absolute positioned)  │
│  z-50, shadow-2xl, rounded-2xl           │
│                                          │
│        April 2026                        │
│   Su Mo Tu We Th Fr Sa                   │
│    ╔═══════╗                             │
│    ║  1  2 ║  3  4  5                    │
│    ║ ██  7 ║  8  9 10 11 12              │  ← selected range highlighted
│    ║13 14 15║16 17 18 19                 │
│    ╚═══════╝                             │
│   20 21 22 23 ░░ ░░ ░░  ← blocked dates │
│   27 28 29 ══ ══  1  2                  │
│                                          │
│  [Past dates: greyed out, cursor-not]    │
│  [Blocked: strikethrough, grey]          │
│  [Check-in: blue circle]                 │
│  [Range: blue background]                │
│  [Check-out: blue circle]                │
│                                          │
│  (Click outside → closes popover)        │
└──────────────────────────────────────────┘
```

---

## 4. Component Structure

### 4.1 Date Selector Strip

Two clickable pill inputs side by side.

| Field | Element | Behavior |
|-------|---------|---------|
| Check-in | `button` with calendar icon + date | Click opens calendar popover in check-in selection mode |
| Check-out | `button` with calendar icon + date | Click opens calendar popover in check-out selection mode |
| Visual state | Active/selected: blue border highlight | Inactive: gray border |

**Calendar selection steps:**
1. User clicks Check-in → calendar opens, `step = 'checkin'`
2. User clicks a date → sets check-in, `step = 'checkout'` (calendar stays open)
3. User clicks a later date → sets check-out, calendar closes
4. If user clicks a date ≤ check-in while in checkout step → resets to that date as new check-in

### 4.2 Calendar Popover Detail

| Element | Spec |
|---------|------|
| Position | `absolute` below the date strip, `z-50` |
| Days grid | `grid-cols-7` |
| Today and past | `text-gray-300 cursor-not-allowed` |
| Blocked dates | `line-through text-gray-300 cursor-not-allowed` (from `isDateBlocked()`) |
| Check-in day | `bg-blue-600 text-white rounded-full` |
| Check-out day | `bg-blue-600 text-white rounded-full` |
| Range in-between | `bg-blue-100 text-blue-800` |
| Hover (available) | `hover:bg-blue-100 hover:text-blue-700` |
| Close on outside click | `useEffect` with `mousedown` listener on `document` |

### 4.3 Guest Selector

Three rows, one per guest type.

| Row | Label | Age range shown | Min | Price effect |
|-----|-------|----------------|-----|-------------|
| Adults | "Adults" | "age 11+" | 1 | Full rate |
| Children | "Children" | `age {min}-{max}` | 0 | `(1 - childDiscount%)` rate |
| Infants | "Infants" | `under {childAgeMin}` | 0 | Free |

Each row:
- Label (bold) + age range descriptor (gray)
- `[−]` decrement button (disabled at minimum)
- Count number (centered, `font-bold text-xl`)
- `[+]` increment button (disabled when total paying guests would exceed max)

**Max paying guests:** Highest `guests` value in `data.pricing.rates[]`.

### 4.4 Validation Error Messages

Displayed as red inline error banners below the date strip when:

| Condition | Message |
|-----------|---------|
| Check-in in the past | "Check-in cannot be in the past." |
| Check-out ≤ check-in | "Check-out must be after check-in." |
| Blocked date in range | "Some dates in your selection are not available." |
| Zero paying adults | "At least 1 adult is required." |
| Over max guests | "Maximum paying guests allowed is N." |

### 4.5 Price Display

Shown when all inputs are valid (valid dates, ≥1 adult, no blocked dates in range).

| Element | Content |
|---------|---------|
| Total price | `¥{total.toLocaleString()}` in large bold text |
| Duration label | `/ {nights} nights` |

### 4.6 Price Breakdown (Expandable)

Toggle: "See how price is calculated ▼ / ▲"

When expanded, shows a line-item table:

| Line | Shown when |
|------|-----------|
| Price / guest / night (¥N) | Always |
| Adults (N × ¥N × N nights) | Adults > 0 |
| Children (N × ¥N × N nights, N% off) | Children > 0 |
| Infants | Infants > 0; shows "Free" |
| Subtotal | Always |
| Long stay discount (−¥N) | When nights ≥ `longStayMinNights` |
| Cleaning fee (+¥N) | Always |
| **Estimate Total** | Always (bold) |

### 4.7 Send Booking Inquiry Button

| State | Appearance |
|-------|-----------|
| Valid (price calculated) | Active, blue, full-width `rounded-2xl` |
| Invalid | Hidden or disabled |

**Action:** Constructs `mailto:` URL with pre-filled Subject + Body containing all booking details, then sets `window.location.href`.

**Sub-label below button:** "Opens your email app" (gray, small text)

---

## 5. States Summary

| State | Widget Behavior |
|-------|----------------|
| Initial (today + today+3) | Dates pre-set, widget shows calculated price |
| Calendar open | Calendar popover visible |
| Dates invalid | Red error message, no price shown, button disabled |
| Valid inputs | Price shown, breakdown expandable, button active |
| Breakdown expanded | Full line-item list visible |
| Breakdown collapsed | Only total shown |

---

## 6. Responsive Placement

| Page | Mobile | Desktop |
|------|--------|---------|
| SCR-02 Homepage | Rendered inline in main content (between sleeping/amenities sections) | Sticky right column (`top-6`, 1/3 width) |
| SCR-05 Pricing | Rendered inline at top of page (`block lg:hidden`) | Not rendered on pricing page desktop (widget is in Layout sidebar) |

---

## V2 Change Request Addendum (2026-05-03)

### Backend + DB Integration

- Widget configuration (rates, fees, policy values) must be loaded via backend property pricing API.
- Optional quote endpoint should validate final pricing server-side for consistency across clients.

### Role Updates

- Guest behavior unchanged (read + inquiry only).
- Host/Admin configuration changes happen in admin modules and flow through APIs to PostgreSQL.
