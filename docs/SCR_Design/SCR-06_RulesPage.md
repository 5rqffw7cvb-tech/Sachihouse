# Screen Design Document — SCR-06: House Rules Page

**Screen ID:** SCR-06  
**Screen Name:** House Rules  
**Route:** `/{id}/rules`  
**File:** `pages/RulesPage.tsx`  
**Layout Wrapper:** `Layout` (property nav + footer)

---

## 1. Screen Overview

A single-purpose informational page displaying the property's house rules with clear visual distinction between forbidden and required/allowed items. Includes an additional notes section for free-text supplemental rules.

---

## 2. Wireframe

```
┌──────────────────────────────────────────────────────┐
│  PROPERTY NAV BAR                                    │
├──────────────────────────────────────────────────────┤
│                                                      │
│  HEADER  [centered]                                  │
│  <data.titles.rules>                                 │
│  <data.titles.rulesSubtitle>                         │
│                                                      │
│  RULE CARDS  (max-w-3xl, stacked vertical)           │
│  ┌────────────────────────────────────────────────┐  │
│  │  [🚬 red bg]   No Smoking                  ●  │  │
│  │                Strictly prohibited in property.│  │
│  └────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────┐  │
│  │  [🎉 red bg]   No Parties                  ●  │  │
│  │                Strictly prohibited in property.│  │
│  └────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────┐  │
│  │  [🌙 green bg]  Quiet after 22:00           ●  │  │
│  │                We appreciate your cooperation. │  │
│  └────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────┐  │
│  │  [👟 red bg]   No Shoes                     ●  │  │
│  │                Strictly prohibited in property.│  │
│  └────────────────────────────────────────────────┘  │
│  ...  (one card per rule in data.rules[])            │
│                                                      │
│  ADDITIONAL NOTES CARD                               │
│  ┌────────────────────────────────────────────────┐  │
│  │  ⚠ Additional Notes                            │  │
│  │  <data.additionalRules text>                   │  │
│  │  (whitespace-pre-line)                         │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
├──────────────────────────────────────────────────────┤
│  FOOTER                                              │
└──────────────────────────────────────────────────────┘
```

---

## 3. UI Components

### 3.1 Page Header

| Element | Type | Source |
|---------|------|--------|
| Title (H1) | `text-3xl font-bold text-gray-900`, centered | `data.titles.rules` |
| Subtitle | `text-gray-500`, centered | `data.titles.rulesSubtitle` |

### 3.2 Rule Card

Each `data.rules[]` item renders one card.

**Card Layout:**
```
┌─────────────────────────────────────────────────────────┐
│  [Icon 56×56   ]   Rule Text (h3)                    ●  │
│  [circle, bg]       "Strictly prohibited" /             │
│                     "We appreciate your cooperation."   │
└─────────────────────────────────────────────────────────┘
```

| Zone | Element | Forbidden (`type === 'forbidden'`) | Allowed/Required |
|------|---------|-----------------------------------|-----------------|
| Icon container | `div` circle | `bg-red-50 text-red-500` | `bg-green-50 text-green-600` |
| Icon | Lucide icon from `iconMap[rule.icon]` | Fallback: `AlertCircle` | Same |
| Rule text | `h3 text-lg font-bold text-gray-900` | Same | Same |
| Sub-text | `p text-gray-500 text-sm` | "Strictly prohibited in the property." | "We appreciate your cooperation." |
| Status dot | `div w-2 h-2 rounded-full ml-auto mt-2` | `bg-red-400` | `bg-green-400` |

**Card style:** `bg-white border border-gray-100 shadow-sm rounded-xl p-6 flex items-start gap-6 hover:shadow-md`

**Available icons:**

| Key | Icon |
|-----|------|
| `CigaretteOff` | No-smoking symbol |
| `PartyPopper` | Party/confetti |
| `Moon` | Night/quiet hours |
| `Footprints` | No shoes |
| _(other values)_ | `AlertCircle` (fallback) |

> Note: The `iconMap` currently only covers 4 icons. Any rule with a different `icon` value renders `AlertCircle`.

### 3.3 Additional Notes Card

| Element | Spec |
|---------|------|
| Container | `mt-8 bg-gray-50 border border-gray-200 rounded-xl p-6` |
| Header | `AlertCircle` icon (gray-600) + "Additional Notes" (bold, gray-900) |
| Content | `data.additionalRules`, `text-gray-600 text-sm whitespace-pre-line leading-relaxed` |

---

## 4. Layout & Spacing

| Property | Value |
|----------|-------|
| Content max-width | `max-w-3xl mx-auto` |
| Horizontal padding | `px-3 sm:px-6 lg:px-8` |
| Vertical padding | `py-8` |
| Card spacing | `space-y-6` |

---

## 5. States

| State | Display |
|-------|---------|
| No rules configured | Empty `space-y-6` container (no cards shown) |
| No additional rules text | `data.additionalRules` renders as empty string |
| Unknown icon key | `AlertCircle` fallback icon renders |

---

## 6. Responsive Behavior

This page has no major responsive layout changes. Content width is constrained to `max-w-3xl` on all screen sizes. The card layout adapts naturally to the available width.

---

## 7. Navigation Flows

```
SCR-06 House Rules Page
  │
  └── Property nav links → SCR-02, 04, 05, 07
  └── Back to Listings → SCR-01
```

---

## V2 Change Request Addendum (2026-05-03)

### Backend + DB Integration

- Rules content must be fetched from property rules API and saved through authenticated update endpoints.
- All write operations must create audit trail records.

### Role Updates

- Host can maintain rules for assigned properties.
- Admin can maintain rules for all properties.
