# Functional Design Document — SachiHouse78

**Project:** `sachihouse-hompage`  
**Version:** 0.0.0  
**Date:** May 2, 2026  
**Document Type:** Functional Design (FD)

---

## Change Request Addendum (May 3, 2026)

This addendum updates the functional baseline to a full-stack architecture and introduces the Host role.

### CR-01: System Scope Expansion

The system now includes:
- Frontend web application.
- Backend application server with authenticated APIs.
- Relational database and background workers.

### CR-02: Database Replacement

Firestore is replaced by **PostgreSQL** as the primary transactional database.

### CR-03: Updated User Roles

| Role | Authentication | Permissions |
|------|---------------|------------|
| **Guest** | None (anonymous) | View public pages, pricing simulation, booking inquiry |
| **Host** | Authenticated account | Manage only properties assigned by Admin; edit content, pricing, rules, media, availability sources |
| **Admin** | Authenticated account with elevated role | Full platform control: all Host permissions + user management + host assignment + global settings |

### CR-04: New Functional Capabilities

- Host assignment management by Admin (assign/unassign property access).
- Role-based access control (RBAC) enforced by backend.
- Property CRUD and Blog CRUD through backend APIs.
- Audit logging for write actions (Admin/Host operations).

### CR-05: Permission Rules (Authoritative)

- Admin can create/delete any property and assign Hosts.
- Host can update only assigned properties and cannot modify assignment mappings.
- Guest has no write access.
- All write authorization decisions are server-side; frontend checks are advisory only.

### CR-06: Feature Mapping Update

- F-10 Admin Property Management: expanded with Host assignment workflows.
- F-11 Admin Blog Management: can optionally delegate authoring privileges to Hosts (configurable policy).
- F-12 Authentication & Authorization: upgraded to JWT/session-based backend auth with role claims and tenant-aware permission checks.

## Table of Contents

1. [Introduction](#1-introduction)
2. [Stakeholders & User Roles](#2-stakeholders--user-roles)
3. [Functional Scope](#3-functional-scope)
4. [Use Case Overview](#4-use-case-overview)
5. [Feature F-01: Multi-Property Listings](#5-feature-f-01-multi-property-listings)
6. [Feature F-02: Property Homepage](#6-feature-f-02-property-homepage)
7. [Feature F-03: Photo Tour Gallery](#7-feature-f-03-photo-tour-gallery)
8. [Feature F-04: Access & Transport Guide](#8-feature-f-04-access--transport-guide)
9. [Feature F-05: Price Simulator & Booking Inquiry](#9-feature-f-05-price-simulator--booking-inquiry)
10. [Feature F-06: Availability Calendar](#10-feature-f-06-availability-calendar)
11. [Feature F-07: House Rules](#11-feature-f-07-house-rules)
12. [Feature F-08: Guest Manual](#12-feature-f-08-guest-manual)
13. [Feature F-09: Blog (Travel Content)](#13-feature-f-09-blog-travel-content)
14. [Feature F-10: Admin — Property Management](#14-feature-f-10-admin--property-management)
15. [Feature F-11: Admin — Blog Management](#15-feature-f-11-admin--blog-management)
16. [Feature F-12: Authentication & Authorization](#16-feature-f-12-authentication--authorization)
17. [Feature F-13: Multi-Language Support](#17-feature-f-13-multi-language-support)
18. [Feature F-14: Theming System](#18-feature-f-14-theming-system)
19. [Feature F-15: iCal Calendar Sync](#19-feature-f-15-ical-calendar-sync)
20. [Feature F-16: SEO Management](#20-feature-f-16-seo-management)
21. [Non-Functional Requirements](#21-non-functional-requirements)
22. [Business Rules Summary](#22-business-rules-summary)
23. [UI/UX Design Principles](#23-uiux-design-principles)
24. [Data Persistence Rules](#24-data-persistence-rules)
25. [Error Handling & Fallback Behavior](#25-error-handling--fallback-behavior)

---

## 1. Introduction

### 1.1 Purpose

This document describes the functional design of the **SachiHouse78** vacation rental management web application. It defines what the system does, who uses it, and how each feature behaves from a functional perspective — without specifying implementation details.

### 1.2 System Description

SachiHouse78 is a **web-based property listing and guest information platform** for short-term rental (minpaku) operators in Japan. It enables property owners to:
- Publish and manage multiple rental property listings on a single platform.
- Provide guests with all necessary information: access directions, pricing, house rules, and a usage manual.
- Allow guests to simulate pricing and submit booking inquiries directly via email.
- Synchronize availability from third-party booking platforms (Airbnb, Booking.com, Agoda) via iCal feeds.
- Publish travel blog content to attract organic traffic and support guests planning their Tokyo visit.

### 1.3 Scope

The system covers the **public guest-facing website** and the **admin management interface**. It does not include:
- Direct payment processing (all transactions occur off-platform via OTA or email).
- Real-time chat or messaging.
- Guest account creation or login.
- Native mobile applications.

### 1.4 Definitions

| Term | Definition |
|------|-----------|
| **Property** | A single rental unit (e.g., "Sachi House: Ojima Tokyo") managed in the system |
| **Listing** | Public-facing representation of a property |
| **Admin** | Authorized property owner/manager with write access |
| **Guest** | Unauthenticated visitor browsing the website |
| **OTA** | Online Travel Agency (Airbnb, Booking.com, Agoda) |
| **iCal** | Internet Calendar (`.ics`) feed used to sync blocked dates from OTAs |
| **Blocked Date** | A date unavailable for booking, sourced from OTA iCal feeds |

---

## 2. Stakeholders & User Roles

### 2.1 User Roles

| Role | Authentication | Permissions |
|------|---------------|------------|
| **Guest** | None (anonymous) | View all public content; use price simulator; send booking inquiry |
| **Admin** | Google Sign-In (whitelisted email) | All guest permissions + create/edit/delete property data, blog posts, site settings |

### 2.2 Role Determination

- **Guest:** Any visitor who has not authenticated.
- **Admin:** A visitor who has authenticated via Google Sign-In with the specific authorized email address (`betopham88@gmail.com`). The system automatically rejects any other Google account.

### 2.3 Stakeholders

| Stakeholder | Interest |
|-------------|---------|
| **Property Owner** | Manage property listings; keep content up to date; receive booking inquiries |
| **Guests / Potential Guests** | Find property information; check availability; understand pricing; send inquiries |
| **Platform Operator** | Manage multiple properties under one brand; publish blog content |

---

## 3. Functional Scope

### 3.1 In Scope

| ID | Feature |
|----|---------|
| F-01 | Multi-property listings page |
| F-02 | Property homepage (description, photos, amenities) |
| F-03 | Full photo tour gallery |
| F-04 | Access and transport guide |
| F-05 | Price simulator and booking inquiry |
| F-06 | Availability calendar (iCal-driven) |
| F-07 | House rules display |
| F-08 | Guest usage manual (accordion FAQ) |
| F-09 | Travel blog (listing + post detail) |
| F-10 | Admin — property content management |
| F-11 | Admin — blog post management |
| F-12 | Authentication and authorization |
| F-13 | Multi-language UI (EN / VI / JA / ZH) |
| F-14 | Per-property theming (color palette) |
| F-15 | iCal calendar synchronization |
| F-16 | SEO meta-data management |

### 3.2 Out of Scope

- Online payment or deposit collection.
- Real-time booking confirmation.
- Guest messaging or chat.
- Review/rating system.
- Server-side rendering.
- Native iOS/Android applications.

---

## 4. Use Case Overview

```
┌───────────────────────────────────────────────────────────────┐
│                         GUEST                                 │
│                                                               │
│  UC-01 Browse property listings                               │
│  UC-02 View property details (homepage)                       │
│  UC-03 Browse photo gallery                                   │
│  UC-04 View transport / access guide                          │
│  UC-05 Simulate stay price                                    │
│  UC-06 Send booking inquiry via email                         │
│  UC-07 Check date availability                                │
│  UC-08 Read house rules                                       │
│  UC-09 Read guest manual / usage guide                        │
│  UC-10 Browse and read blog posts                             │
│  UC-11 Filter blog by category or search                      │
│  UC-12 Switch UI language                                     │
└───────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────┐
│                         ADMIN                                 │
│                                                               │
│  UC-13 Sign in with Google                                    │
│  UC-14 Create a new property listing                          │
│  UC-15 Edit property content (all tabs)                       │
│  UC-16 Delete a property listing                              │
│  UC-17 Manage iCal feed URLs                                  │
│  UC-18 Edit site-level settings (nav, footer, header)         │
│  UC-19 Create / edit / delete blog posts                      │
│  UC-20 Seed blog with sample data                             │
│  UC-21 Sign out                                               │
└───────────────────────────────────────────────────────────────┘
```

---

## 5. Feature F-01: Multi-Property Listings

### 5.1 Description

The platform homepage (`/`) displays all registered properties as browsable cards. It serves as the entry point for guests to find a property, and for admins to manage the property portfolio.

### 5.2 Guest Behavior

- The page displays a grid of **property cards**, each showing:
  - Property name and subtitle/tagline.
  - Address.
  - Key stats: maximum guests, bedrooms, bathrooms.
  - Superhost badge (if applicable).
  - A thumbnail image (derived from gallery or placeholder).
- Clicking a property card navigates to `/{propertyId}/` (the property homepage).
- A **search bar** at the top allows filtering properties by name or subtitle (client-side, real-time filter).

### 5.3 Admin Behavior (when authenticated)

- An **"Edit Page Content"** button appears, opening a modal to edit site-wide settings:
  - Navigation bar title.
  - Page header title and subtitle.
  - Footer brand name.
  - Footer copyright text.
- A **"New Listing"** button creates a new property with a randomly generated ID and navigates the admin directly to `/{newId}/admin` to begin setup.
- Each property card shows a **delete icon** (trash). Clicking it requires confirmation before permanently deleting the property from the database.

### 5.4 Business Rules

- **BR-01:** Any visitor may view the listings page.
- **BR-02:** Only an authenticated admin may create, delete, or edit site settings.
- **BR-03:** Deleting a property is irreversible and requires explicit confirmation.
- **BR-04:** Properties are listed in the order returned from the database (Firestore, unordered by default).

---

## 6. Feature F-02: Property Homepage

### 6.1 Description

The property homepage (`/{id}/`) is the primary guest-facing page — equivalent to an Airbnb listing page. It presents all key information about a single property.

### 6.2 Content Sections

| Section | Content |
|---------|---------|
| **Hero Gallery** | Up to 5 "featured" photos in a responsive grid layout. A "Show all photos" button links to the photo tour page. |
| **Property Header** | Name, subtitle, guest capacity, bedroom/bed/bathroom count, superhost badge. |
| **Highlights** | Up to 3 key selling points (e.g., "Park Front", "Work Ready") with icons and short descriptions. |
| **Description** | Full property description. Text truncated to ~300 characters by default, expandable with "Show more / Show less" toggle. |
| **Sleeping Arrangements** | Cards for each bedroom/sleeping area showing photo, title, and description. Each card has a "View photos" button that opens a photo lightbox for that room. |
| **Amenities** | Grid of amenity chips with matching icons. First 10 shown by default, expandable to show all. |
| **Booking Platforms** | Links to the property's Airbnb, Booking.com, and/or Agoda listings (shown only if URLs are configured). |
| **Location Map** | Embedded Google Maps iframe centered on the property. |
| **Host Profile** | Host photo, name, "Superhost since" year, and review count. |

### 6.3 Booking Widget

The **Price Simulator widget** is prominently displayed:
- On **desktop**: fixed in a sticky right-side column.
- On **mobile**: displayed inline between the sleeping arrangements and amenities sections.

### 6.4 Business Rules

- **BR-05:** Gallery images with `showOnHome: true` are shown in the hero section, up to a maximum of 5 images.
- **BR-06:** The "Show all photos" button is always visible if any gallery images exist.
- **BR-07:** Booking platform buttons are only rendered when their corresponding URL is configured in the property data.

---

## 7. Feature F-03: Photo Tour Gallery

### 7.1 Description

A dedicated full-screen gallery page (`/{id}/photos`) displays all property photos organized by room/category.

### 7.2 Guest Behavior

- Photos are grouped under **category headings** (e.g., Floor Plan, Living Room, Kitchen & Dining, Bedroom, Bathroom, Exterior, Other).
- The **Floor Plan** category is rendered with special treatment: the first image fills a wide widescreen (`aspect-video`) container using `object-contain` (no cropping) to preserve blueprint legibility.
- All other categories display images in a 3-column responsive grid.
- Images are **lazy-loaded** for performance.
- A **back button** in the header returns the guest to the previous page (property homepage).

### 7.3 Room-Level Lightbox (from HomePage)

From the **Sleeping Arrangements** section on the property homepage, each room card can open a lightbox gallery:
- Full-screen dark overlay.
- Image counter: `1 / N · Room Name`.
- Left/right arrow navigation on desktop.
- Keyboard navigation: `←` `→` `Escape`.
- Thumbnail strip at the bottom for quick jump.

### 7.4 Business Rules

- **BR-08:** Empty categories (no images assigned) are silently omitted from the photo tour page.
- **BR-09:** Gallery categories and their order are defined by the `galleryCategories` array in property data.
- **BR-10:** The lightbox keyboard listener is registered on `window` and cleaned up on close.

---

## 8. Feature F-04: Access & Transport Guide

### 8.1 Description

The Access page (`/{id}/access`) helps guests plan their journey to the property.

### 8.2 Content Sections

| Section | Content |
|---------|---------|
| **Location Map** | Full-width embedded Google Maps iframe. Map is greyscale by default and switches to full color on hover. On desktop, an address overlay badge is shown over the map. |
| **YouTube Walking Guide** | An embedded YouTube video showing the walking route from the nearest station. Only shown when a YouTube URL is configured. Includes a "Watch on YouTube" fallback link. |
| **By Train** | Multi-line text block with train line information, walking times, and connections. |
| **From Airports** | Multi-line text block with airport transfer directions from Narita and Haneda. |
| **Check-in Details** | Multi-line text block with check-in/check-out times and self-check-in instructions. |

### 8.3 Business Rules

- **BR-11:** The YouTube video section is only rendered when `data.accessInfo.youtubeGuideUrl` is a valid YouTube URL.
- **BR-12:** The system supports YouTube URL formats: `youtu.be/`, `watch?v=`, `embed/`, `shorts/`, and `u/w/` formats.
- **BR-13:** All access text sections support newline characters for multi-line display (`whitespace-pre-line`).

---

## 9. Feature F-05: Price Simulator & Booking Inquiry

### 9.1 Description

The **Price Simulator** (`BookingWidget`) allows guests to calculate the estimated cost of their stay and send a pre-filled booking inquiry to the host via email.

### 9.2 Inputs

| Input | Type | Default | Validation |
|-------|------|---------|------------|
| Check-in date | Date picker (calendar) | Today | Cannot be in the past |
| Check-out date | Date picker (calendar) | Today + 3 days | Must be after check-in |
| Adults | Integer stepper | 2 | Minimum 1 |
| Children (age 3–10) | Integer stepper | 0 | Minimum 0 |
| Infants (under 3) | Integer stepper | 0 | Minimum 0; free of charge |

### 9.3 Price Calculation Logic

The system calculates price according to the following rules:

1. **Paying guests** = Adults + Children (Infants are free and excluded from pricing).
2. **Price per guest per night** is determined by a lookup table based on total paying guests.
3. **Adult cost** = Adults × Price per guest × Nights.
4. **Child cost** = Children × (Price per guest × (1 − childDiscountPercent/100)) × Nights. The child unit price is rounded before multiplication.
5. **Subtotal** = Adult cost + Child cost.
6. **Long-stay discount**: If nights ≥ `longStayMinNights`, the subtotal is multiplied by `(1 − longStayDiscountPercent/100)`.
7. **Cleaning fee** is a flat fee determined by a tiered lookup based on total paying guests.
8. **Total** = round(discounted subtotal + cleaning fee).

### 9.4 Calendar UI

- A popover calendar opens when the guest clicks a date input.
- Blocked/unavailable dates are shown with strikethrough and grey styling.
- Selected date range is highlighted.
- Selection is two-step: first click sets check-in, second click sets check-out.
- If the guest clicks a date earlier than the current check-in when selecting check-out, the system resets and treats the clicked date as a new check-in.
- The calendar closes automatically once both dates are selected.
- Clicking outside the calendar popover closes it.

### 9.5 Validation & Error Display

| Condition | Message Shown |
|-----------|--------------|
| Check-in is in the past | "Check-in cannot be in the past." |
| Check-out is not after check-in | "Check-out must be after check-in." |
| Selected range contains a blocked date | "Some dates are not available." |
| Paying guests exceed configured maximum | "Maximum paying guests allowed is N." |
| No adult selected | "At least 1 adult is required." |

### 9.6 Price Breakdown Display

A collapsible "See how price is calculated" section shows:
- Price per guest per night (for the selected guest count).
- Adult subtotal.
- Child subtotal (with discount rate shown).
- Infants line: Free.
- Subtotal before discounts.
- Long-stay discount amount (only shown when applicable).
- Cleaning fee.
- **Total estimate** (bold, prominent).

### 9.7 Booking Inquiry (Email)

When the guest clicks **"Send Booking Inquiry"**:
- The system constructs a `mailto:` URL with:
  - **To:** The property's admin email address.
  - **Subject:** `Booking Inquiry: Tokyo Zen Stay (YYYY-MM-DD - YYYY-MM-DD)`.
  - **Body:** Check-in date, check-out date, number of nights, guest breakdown, estimated total.
- The system calls `window.location.href` with the `mailto:` URL to open the device's default email client.
- A note below the button informs the guest that this opens their email client.
- The button is disabled / not shown when the calculation result is invalid.

### 9.8 Business Rules

- **BR-14:** Infants (age < `childAgeMin`, default 3) are always free and do not count toward pricing tiers.
- **BR-15:** Children (age `childAgeMin` to `childAgeMax`, default 3–10) receive the configured child discount on the per-guest price.
- **BR-16:** The long-stay discount and child discount can both apply to the same booking; they stack multiplicatively (child discount applied per unit, long-stay applied on subtotal).
- **BR-17:** The cleaning fee is a flat per-booking fee that is NOT discounted, even with a long-stay discount.
- **BR-18:** The maximum paying guests is the highest value defined in the pricing `rates` array (not `maxGuests`).

---

## 10. Feature F-06: Availability Calendar

### 10.1 Description

The Pricing page (`/{id}/pricing`) includes a visual calendar showing which dates are available or blocked.

### 10.2 Guest Behavior

- Two months are displayed simultaneously (current month and next month).
- **Available dates** are shown with a light hover effect (blue highlight on hover).
- **Blocked dates** are shown with strikethrough text and a grey muted style.
- Navigation arrows ("Previous Month" / "Next Month") let the guest browse further.
- Calendar day names are abbreviated: Su, Mo, Tu, We, Th, Fr, Sa.

### 10.3 Data Source

Blocked dates are sourced from iCal feeds (see F-15). The calendar reads from an in-memory cache that is populated in the background after the property data loads. The calendar re-renders automatically when the iCal sync completes.

### 10.4 Business Rules

- **BR-19:** The availability calendar is read-only for guests; clicking a date does not trigger any action on the Pricing page itself (interaction only within the BookingWidget calendar).
- **BR-20:** If iCal sync fails or no feeds are configured, all dates are shown as available (no false negatives).

---

## 11. Feature F-07: House Rules

### 11.1 Description

The Rules page (`/{id}/rules`) displays the property's house rules in a clear, visual format.

### 11.2 Content

- Each rule is shown as a card with:
  - An **icon** (from the Lucide icon set) representing the rule topic.
  - The **rule text** (e.g., "No smoking inside").
  - A **type indicator**: forbidden rules have a red background and a red dot; allowed/required rules have a green background and a green dot.
- A secondary text line clarifies intent: `"Strictly prohibited in the property."` for forbidden rules, or `"We appreciate your cooperation."` for allowed/required rules.
- An **Additional Notes** section below the rules list displays free-text supplemental rules (e.g., garbage separation instructions, key replacement fee).

### 11.3 Business Rules

- **BR-21:** Rules are displayed in the order they appear in the `data.rules` array.
- **BR-22:** The additional notes section uses `whitespace-pre-line` formatting to respect line breaks entered by the admin.

---

## 12. Feature F-08: Guest Manual

### 12.1 Description

The Manual page (`/{id}/manual`) provides an accordion-style guide for guests on how to use the property's appliances and facilities.

### 12.2 Guest Behavior

- A **search bar** at the top allows real-time filtering of manual items by title or content (case-insensitive).
- Manual items are displayed as **accordion cards**. Only one item can be expanded at a time.
- The **first item is expanded by default** on page load.
- When expanded, each item shows:
  - An optional **image** (e.g., photo of the appliance or location).
  - The **content text** displayed with `whitespace-pre-line` to preserve formatting.
- When no search results are found, a "No guides found matching..." message is displayed.

### 12.3 Business Rules

- **BR-23:** Search filters both `title` and `content` fields simultaneously.
- **BR-24:** Clicking an already-open accordion item collapses it.
- **BR-25:** The search field is cleared when the guest navigates away (state is not persisted).

---

## 13. Feature F-09: Blog (Travel Content)

### 13.1 Description

The blog section (`/blog`) publishes travel stories and practical tips about Tokyo to attract organic search traffic and support guests planning their visit.

### 13.2 Blog Listing Page

- The page header shows the blog title and description.
- A **featured post** occupies a large hero card at the top (full-width image, title, excerpt, date). The featured post is the one with `isFeatured: true`; if none, the first post in the list is used.
- Remaining posts are shown in a **2-column card grid** (1 column on mobile).
- Each card shows: thumbnail image, category badge, title, excerpt, and date.
- Clicking any card navigates to the blog post detail page.
- A **pagination** control appears when more posts exist than fit on one page.

### 13.3 Blog Post Detail Page

- Renders the post's **Markdown content** using a styled prose renderer.
- Shows: post title, category badge, publication date.
- A "Back to Blog" link returns to the listing page.
- An **"Edit"** (pencil) icon button appears in the header if the user is authenticated as admin — clicking navigates to the admin blog editor pre-loaded with this post.
- Full Open Graph and Twitter Card meta tags are set for social sharing.

### 13.4 Filtering & Search

- **Category filter:** Applied via `?category={name}` URL parameter. Shown in the page header as "Category: {name}" with a "Clear filter" link.
- **Search filter:** Applied via `?q={term}` URL parameter. Searches post title, excerpt, and full content. Shown as "Search: {term}" in the header.
- Both filters apply simultaneously if both params are present.
- The **BlogSidebar** (visible on `lg` screens and above) shows:
  - A search form that updates the `?q` URL parameter.
  - A categories list with post counts, sorted by count descending.
  - A "Recent Posts" list showing the 4 most recently created posts.

### 13.5 Business Rules

- **BR-26:** Blog posts are always listed in descending order of `createdAt` (newest first).
- **BR-27:** The featured post hero is hidden when any filter is active (category or search).
- **BR-28:** A post is excluded from the "regular posts" grid if it is already shown as the featured post.
- **BR-29:** Blog post content supports full Markdown syntax (headings, bold, italic, lists, blockquotes, code blocks).

---

## 14. Feature F-10: Admin — Property Management

### 14.1 Description

The Admin page (`/{id}/admin`) provides a comprehensive CMS for the property owner to manage all content for a specific property.

### 14.2 Authentication Gate

- If the user is not authenticated, the page shows a **login screen** with a "Sign in with Google" button.
- Authentication is via Google Sign-In (OAuth 2.0). Only the authorized admin email is accepted.
- After successful login, the full admin interface is displayed.
- A "Sign Out" button is available in the top-right corner of the admin interface.

### 14.3 Tab-Based Interface

The admin interface is organized into tabs:

#### Tab: General

Editable fields:

| Field | Description |
|-------|-------------|
| Property Name | Primary display name |
| Meta Title | Browser tab `<title>` tag |
| Favicon URL | Browser favicon image URL |
| Subtitle | Short tagline |
| Description | Full property description (long text) |
| Address | Human-readable address |
| Google Maps Embed URL | Full iframe `src` URL |
| Host Name | Host's first name |
| Host Image URL | Host profile photo URL |
| Superhost | Toggle: Is Superhost? |
| Superhost Since | Year string |
| Admin Email | Email address for booking inquiries |
| Max Guests | Physical guest capacity |
| Bedrooms | Count |
| Beds | Total bed count |
| Bathrooms | Count |
| Theme Color | Dropdown: blue / airbnb / booking / agoda |
| Airbnb URL | Link to Airbnb listing |
| Booking.com URL | Link to Booking.com listing |
| Agoda URL | Link to Agoda listing |
| Social / Footer Image | URL for footer image |

#### Tab: Pricing

- **Rate Tiers:** Add/remove/edit rows of `{ guests, price_per_night }`.
- **Cleaning Fee Tiers:** Add/remove/edit rows of `{ min_guests, max_guests, cleaning_fee }`.
- **Child Discount:** Percent off for children (age 3–10).
- **Child Age Range:** Configurable min and max age for child pricing.
- **Long-Stay Discount:** Percent off for stays meeting minimum nights.
- **Long-Stay Minimum Nights:** Threshold to qualify for long-stay discount.

#### Tab: Availability (iCal)

- List of configured iCal feeds with: name, URL, last synced timestamp.
- **Add Feed:** Name + URL input, adds a new feed entry.
- **Remove Feed:** Delete button per feed entry.
- **Sync:** iCal refresh is triggered automatically after saving.

#### Tab: Amenities

- Categorized checkbox grid of preset amenities:
  - Essentials (Wifi, TV, Washing Machine, Air conditioning, etc.)
  - Kitchen & Dining (Kitchen, Refrigerator, Microwave, Rice cooker, etc.)
  - Bathroom (Shower, Bathtub, Hot water, Shampoo)
  - Features (Self check-in, Free parking, BBQ grill, etc.)
  - Safety (Smoke alarm, Fire extinguisher, First aid kit, etc.)
- Checking a box adds the amenity name to `data.amenities`; unchecking removes it.
- **Custom Amenity:** A text input allows adding any amenity not in the preset list.

#### Tab: House Rules

- List of current rules, each showing: icon, text, type (allowed/forbidden).
- **Add Rule:** Form with fields: Rule Text, Icon (dropdown), Type (allowed/forbidden).
- **Edit Rule:** In-place editing of existing rules.
- **Delete Rule:** Remove button per rule.
- Icon options available: No Smoking, No Parties, Quiet Hours, No Shoes, Wifi, Pets, Music, Food, Check Mark, Alert.

#### Tab: Manual

- List of current manual items (title, content preview).
- **Add Item:** Form with: Title, Content (multi-line text), Image URL (optional).
- **Edit Item:** In-place editing.
- **Delete Item:** Remove button per item.
- Items can be reordered (order matters for display sequence).

#### Tab: Gallery

- **Category Management:** Add or delete gallery category definitions. Cannot delete a category while images are assigned to it.
- **Image List:** All gallery images listed, grouped or filterable by category.
- **Add Image:** Form with: Image URL, Caption, Category (dropdown), Show on Home (toggle).
- **Edit Image:** In-place editing of all fields.
- **Delete Image:** Remove button per image.
- **Show on Home toggle:** Controls which images appear in the hero gallery on the property homepage (up to 5 recommended).

#### Tab: Sleeping Arrangements (Rooms)

- List of sleeping arrangement entries.
- **Add Room:** Form with: Title, Description, Main Image URL.
- **Add Room Photos:** Multiple photo URLs for the lightbox gallery.
- **Edit / Delete** per room.

#### Tab: Highlights

- Exactly 3 highlight cards (fixed count, representing key selling points).
- Each editable: Title, Description, Icon (from highlight icon dropdown).

#### Tab: Access

- Multi-line text editors for: By Train, From Airports, Check-in Details.
- YouTube Guide URL field.

#### Tab: Labels

- Override default UI text strings for this property (e.g., rename "Manual" to "House Guide").
- Editable fields for all 12 `PropertyTitles` keys:
  - Page titles: About, Sleeping, Amenities, Access (+ subtitle), Pricing (+ subtitle), Rules (+ subtitle), Manual (+ subtitle).
  - Navigation menu labels: Home, Access, Pricing, Rules, Manual.

### 14.4 Save Behavior

- A **"Save"** button at the top of each tab submits all changes to Firestore.
- While saving: button shows a spinning loader.
- On success: button shows "Saved!" with a green checkmark for 2 seconds.
- On error: an error message is shown.
- Changes are immediately reflected on the public-facing pages (cache is updated).

### 14.5 Business Rules

- **BR-30:** Only the authenticated admin can access the admin interface.
- **BR-31:** The entire `PropertyData` object is written to Firestore on each save (full overwrite, not partial update).
- **BR-32:** Gallery categories cannot be deleted if they have images assigned to them.
- **BR-33:** The Highlights tab always shows exactly 3 entries; they cannot be added or removed.

---

## 15. Feature F-11: Admin — Blog Management

### 15.1 Description

The Blog Admin page (`/blog/admin`) allows the admin to create, edit, and delete blog posts.

### 15.2 Authentication Gate

Same as F-10: Google Sign-In required with authorized email.

### 15.3 Post List View

- Shows all blog posts in a table/list with: title, category, featured flag, creation date.
- **Edit button** per post: opens the inline editor pre-filled with the post's data.
- **Delete button** per post: immediately deletes the post after confirmation.
- **"New Post" button**: opens the editor with empty fields.

### 15.4 Post Editor

A full-page editor with the following fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| Title | Text input | Yes | Post headline |
| Excerpt | Text input | No | Short summary (shown in listing cards) |
| Image URL | Text input | No | Hero image URL |
| Category | Text input | No | Category tag (e.g., "Travel Stories", "Local Tips") |
| Featured | Checkbox | No | Sets this post as the featured hero on blog listing |
| Content | Textarea | Yes | Full post body in Markdown format |

- **Save button:** Creates (if new) or updates (if editing existing) the post in Firestore.
- **Cancel button:** Discards changes and returns to the post list.

### 15.5 Seed Functionality

- A **"Seed Sample Data"** button is available to admins.
- When clicked, it imports all posts from `data/blogData.ts` into Firestore.
- This is a one-time setup action for initial database population.
- Seed posts use fixed IDs so running the seed multiple times is idempotent (overwrites existing).

### 15.6 Deep-Link Edit

- From the `BlogPostPage`, an admin clicking the "Edit" pencil button is navigated to `/blog/admin?edit={postId}`.
- On load, if the `?edit` URL parameter is present, the admin page automatically opens the editor for that post.
- The URL parameter is cleared after the editor opens.

### 15.7 Business Rules

- **BR-34:** A blog post cannot be saved without a title and content.
- **BR-35:** `createdAt` is set on creation and never changed on updates. `updatedAt` is updated on every save.
- **BR-36:** The `authorId` is set to the Firebase UID of the currently authenticated user on creation.

---

## 16. Feature F-12: Authentication & Authorization

### 16.1 Description

The system uses **Google Sign-In** (OAuth 2.0 via Firebase Authentication) for admin access. There are no guest accounts.

### 16.2 Sign-In Flow

1. Admin clicks the login button (gear icon on desktop top nav, or "Admin" tab on mobile bottom nav).
2. A Google OAuth popup opens.
3. The user selects a Google account and grants consent.
4. Firebase returns the authenticated user.
5. **Email whitelist check:** If the authenticated email matches `betopham88@gmail.com`, login succeeds. Otherwise, the system immediately signs the user out and displays "Unauthorized email address."
6. On success, admin controls become visible across the UI.

### 16.3 Sign-Out Flow

1. Admin clicks "Sign Out" in the user dropdown (desktop top nav or mobile bottom nav).
2. Firebase signs the user out.
3. Admin controls are hidden; the UI returns to guest-only view.

### 16.4 Session Persistence

- Firebase Authentication persists the session in browser storage (IndexedDB/localStorage).
- On page reload, the `onAuthStateChanged` listener fires within ~2 seconds, restoring admin controls if the session is still valid.
- The 2-second delay is intentional to avoid blocking the initial page render (performance optimization).

### 16.5 Authorization Enforcement

Authentication is enforced at two levels:

| Level | Mechanism |
|-------|----------|
| **Client-side** | Admin UI tabs/buttons are conditionally rendered based on `isAuthenticated` state. |
| **Server-side** | Firestore Security Rules reject write operations from unauthenticated or non-admin users. |

Server-side rules are authoritative — client-side is cosmetic protection only.

### 16.6 Business Rules

- **BR-37:** Only one admin email address is authorized; this is hardcoded in both `auth.ts` and `firestore.rules`.
- **BR-38:** The admin email must be Google-verified (`email_verified === true` in the Firebase token).
- **BR-39:** Admin status is re-validated by the server on every Firestore write attempt.

---

## 17. Feature F-13: Multi-Language Support

### 17.1 Description

The UI supports 4 languages, switchable by any user without authentication.

### 17.2 Supported Languages

| Code | Language | Short Label |
|------|----------|-------------|
| `en` | English | EN |
| `vi` | Vietnamese | VN |
| `ja` | Japanese | JP |
| `zh` | Simplified Chinese | CN |

### 17.3 Language Switching

- A **language toggle button** is available in the `Layout` component's desktop navigation bar.
- Clicking cycles through languages in the order: EN → VN → JP → CN → EN.
- The current language is displayed as a short label (e.g., "EN").
- The button tooltip shows the full language name.

### 17.4 Persistence

- The selected language is saved to `localStorage` under the key `'app_language'`.
- On page load, the stored language is restored if it is one of the four supported values.
- If no stored preference exists, `'en'` (English) is the default.

### 17.5 Translation Coverage

The following UI elements are translated:

| Area | Translated Elements |
|------|-------------------|
| Navigation | All menu item labels |
| Booking Widget | All labels, buttons, error messages |
| Home Page | Section titles, button labels |
| Access Page | Section headings |
| Pricing Page | Section titles, calendar labels |
| Common | Loading, Error, Save, Saved |
| Footer | Rights reserved text |

### 17.6 Untranslated Content

The following content is **not** translated (always shown in the language entered by the admin):
- Property name, description, subtitle.
- Access info text blocks.
- House rules text.
- Manual items.
- Blog post content.
- Custom `PropertyTitles` overrides (applied only in `'en'` mode; other languages use translation keys).

### 17.7 Business Rules

- **BR-40:** If a translation key is missing for the current language, the English value is used as fallback. If the English value is also missing, the raw key string is shown.
- **BR-41:** Language switching takes effect immediately without a page reload.

---

## 18. Feature F-14: Theming System

### 18.1 Description

Each property can be assigned a **color theme** that changes the primary color palette of its property pages.

### 18.2 Available Themes

| Theme ID | Brand | Primary Color | Use Case |
|----------|-------|--------------|----------|
| `blue` | Facebook Blue | `#2563EB` | General / Default |
| `airbnb` | Airbnb Red-Pink | `#FF385C` | Properties listed primarily on Airbnb |
| `booking` | Booking.com Navy | `#003580` | Properties listed primarily on Booking.com |
| `agoda` | Agoda Teal | `#32a081` | Properties listed primarily on Agoda |

### 18.3 Behavior

- The theme is set per-property in `PropertyData.themeColor`.
- On property page load, the selected theme's color values are injected as CSS custom properties on the root HTML element.
- Theme changes affect: buttons, links, active nav indicators, calendar highlights, icon accents.
- The theme only applies within `/{id}/` property routes. The blog and listings pages use a fixed neutral design.
- Changing the theme in the Admin "General" tab takes effect immediately after saving.

### 18.4 Business Rules

- **BR-42:** If no theme is set or an invalid theme value is stored, `'blue'` is used as the default.
- **BR-43:** Theming applies only to the property-scoped pages (Layout wrapper), not to global pages (TopNavBar, Footer, Blog, Listings).

---

## 19. Feature F-15: iCal Calendar Sync

### 19.1 Description

The system synchronizes availability data from third-party OTA platforms (Airbnb, Booking.com, Agoda, etc.) by fetching their iCal (`.ics`) calendar feeds and marking the booked dates as unavailable.

### 19.2 Configuration

- The admin enters one or more iCal feed URLs in the **Availability** admin tab.
- Each feed has a: Name (e.g., "Airbnb"), URL (`.ics` link from the OTA platform), and a "Last Synced" timestamp.

### 19.3 Sync Trigger Points

The iCal feeds are refreshed:
1. **On initial property load** — after `PropertyData` is fetched from Firestore.
2. **After an admin saves** — after property data is updated (including updated iCal URLs).

### 19.4 Sync Process

1. For each configured iCal feed URL, the system fetches the `.ics` content.
2. Because OTA iCal URLs do not support CORS, the system routes the request through a chain of public CORS proxy services. Three proxies are tried in sequence until one succeeds.
3. The fetched `.ics` content is parsed to extract all `VEVENT` blocks.
4. Each event's `DTSTART` and `DTEND` dates are converted to a list of individual blocked dates (daily granularity). `DTEND` is treated as exclusive per the iCal specification.
5. All blocked dates from all feeds are merged into a single in-memory set.
6. A DOM event (`'ical-updated'`) is dispatched to notify the UI to re-render calendars.

### 19.5 Availability Check

- Any component needing to know if a date is blocked calls `isDateBlocked(date)` — a synchronous function that checks the in-memory set.
- The booking widget calendar and the pricing page calendar both use this function.

### 19.6 Business Rules

- **BR-44:** iCal URLs containing `...` (literal placeholder text) are silently skipped and never fetched.
- **BR-45:** If all three CORS proxies fail for a feed, that feed is silently ignored. The system does not retry and does not surface an error to the guest.
- **BR-46:** The sync runs at most once at a time; a guard flag prevents concurrent sync operations.
- **BR-47:** Blocked date data is stored only in memory (not persisted to localStorage or Firestore). It is re-fetched fresh on each page load.

---

## 20. Feature F-16: SEO Management

### 20.1 Description

The system provides SEO optimization at two levels: property-level and blog-level.

### 20.2 Property-Level SEO

Configured in the Admin "General" tab:

| Setting | Effect |
|---------|--------|
| **Meta Title** | Sets the browser `<title>` tag for all property pages |
| **Favicon** | Sets the browser tab favicon icon (`<link rel="icon">`) |

These are applied imperatively via DOM manipulation when the property data loads.

### 20.3 Blog-Level SEO

Each blog page sets the following meta tags via `react-helmet-async`:

| Tag | Value |
|-----|-------|
| `<title>` | Post title + site name, or listing page title |
| `<meta name="description">` | Post excerpt or listing page description |
| `<meta property="og:title">` | Same as `<title>` |
| `<meta property="og:description">` | Same as description |
| `<meta property="og:image">` | Post hero image URL |
| `<meta property="og:type">` | `article` for posts, `website` for listing |
| `<meta name="twitter:card">` | `summary_large_image` |
| `<meta name="twitter:title">` | Same as OG title |
| `<meta name="twitter:description">` | Same as OG description |
| `<meta name="twitter:image">` | Same as OG image |

### 20.4 Business Rules

- **BR-48:** Property meta title defaults to `data.name` if `data.metaTitle` is not set.
- **BR-49:** The favicon is only updated when `data.metaFavicon` has a value.
- **BR-50:** Blog pages use `react-helmet-async` (declarative), while property pages use direct DOM manipulation (imperative). Both are correct for their respective use cases.

---

## 21. Non-Functional Requirements

### 21.1 Performance

| Requirement | Target |
|-------------|--------|
| Initial page load (no cache) | Spinner visible, content appears within ~2s on standard connection |
| Cached page load | Instant (content from `localStorage` shown immediately) |
| Image loading | Lazy-loaded where performance matters |
| Code splitting | All pages are lazy-loaded via `React.lazy` to reduce initial JS bundle size |
| Firebase SDK loading | Dynamically imported on first use (not included in initial bundle) |

### 21.2 Accessibility

| Requirement | Implementation |
|-------------|---------------|
| Keyboard navigation | Calendar widget supports keyboard arrow keys and Escape |
| Image alt text | Gallery images include `alt` attributes from `caption` field |
| Focus management | Buttons and links are standard HTML elements with natural tab order |
| Color contrast | Tailwind default utilities used; primary colors chosen for sufficient contrast |

### 21.3 Responsive Design

| Breakpoint | Behavior |
|------------|---------|
| Mobile (default) | Single column layout; bottom navigation bar; BookingWidget inline |
| Tablet (`md:`) | Desktop navigation appears; multi-column layouts activate |
| Desktop (`lg:`) | Full multi-column layout; sticky BookingWidget in right column; BlogSidebar visible |

### 21.4 Browser Compatibility

- **Target:** Modern evergreen browsers (Chrome, Firefox, Safari, Edge).
- **Build target:** `esnext` — no transpilation to legacy JS.
- **iOS Safari:** Mobile bottom nav uses `env(safe-area-inset-bottom)` for proper home-indicator spacing.

### 21.5 Security

| Requirement | Implementation |
|-------------|---------------|
| Admin authentication | Firebase Authentication (Google OAuth 2.0) |
| Server-side authorization | Firestore Security Rules enforce admin-only writes |
| Input size limits | Firestore rules validate maximum string lengths |
| ID format validation | Property, blog post, and settings IDs must match `^[a-zA-Z0-9_\-]+$` |
| No credentials in frontend | Firebase config stored in `firebase-applet-config.json` (should be restricted in production) |

### 21.6 Availability & Hosting

- The application is a static SPA and can be hosted on any static hosting service.
- All dynamic data is served from Firebase (Google Cloud infrastructure).
- The application functions in read-only mode (with cached data) even when Firestore is temporarily unavailable.

---

## 22. Business Rules Summary

| ID | Rule |
|----|------|
| BR-01 | Any visitor may view the listings page |
| BR-02 | Only authenticated admin may create, delete, or edit site settings |
| BR-03 | Deleting a property is irreversible and requires confirmation |
| BR-04 | Properties are listed in database order (no custom sort) |
| BR-05 | Hero gallery shows `showOnHome: true` images, max 5 |
| BR-06 | "Show all photos" is visible whenever gallery images exist |
| BR-07 | Platform booking buttons only render when URL is configured |
| BR-08 | Empty photo categories are hidden on the photo tour page |
| BR-09 | Gallery category order follows the `galleryCategories` array order |
| BR-10 | Lightbox keyboard listener is cleaned up on close |
| BR-11 | YouTube section only renders for valid YouTube URLs |
| BR-12 | Multiple YouTube URL formats are supported |
| BR-13 | Access text supports newlines (whitespace-pre-line) |
| BR-14 | Infants (age < childAgeMin) are always free |
| BR-15 | Children (age childAgeMin–childAgeMax) receive child discount |
| BR-16 | Child discount and long-stay discount stack |
| BR-17 | Cleaning fee is never discounted |
| BR-18 | Max paying guests = highest value in rates array |
| BR-19 | Availability calendar on Pricing page is read-only |
| BR-20 | All dates shown as available if iCal sync fails |
| BR-21 | House rules display in `data.rules` array order |
| BR-22 | Additional notes support newlines |
| BR-23 | Manual search filters both title and content |
| BR-24 | Clicking open accordion item collapses it |
| BR-25 | Manual search state is not persisted |
| BR-26 | Blog posts sorted newest-first |
| BR-27 | Featured post hero hidden when filter is active |
| BR-28 | Featured post excluded from the regular grid |
| BR-29 | Blog content supports full Markdown |
| BR-30 | Only authenticated admin can access admin interface |
| BR-31 | Admin saves are full overwrites (not partial updates) |
| BR-32 | Gallery categories cannot be deleted if images are assigned |
| BR-33 | Highlights section always has exactly 3 entries |
| BR-34 | Blog post requires title and content to save |
| BR-35 | `createdAt` is immutable after creation |
| BR-36 | `authorId` is set from Firebase UID on creation |
| BR-37 | Only one hardcoded admin email is authorized |
| BR-38 | Admin email must be Google-verified |
| BR-39 | Server-side Firestore rules re-validate on every write |
| BR-40 | Missing translation keys fall back to English |
| BR-41 | Language switching is instant (no page reload) |
| BR-42 | Invalid/missing theme defaults to `'blue'` |
| BR-43 | Theming applies only to property-scoped pages |
| BR-44 | iCal placeholder URLs (`...`) are skipped silently |
| BR-45 | iCal proxy failures are silently ignored |
| BR-46 | iCal sync has a concurrency guard (one at a time) |
| BR-47 | Blocked dates are in-memory only (not persisted) |
| BR-48 | Meta title defaults to `data.name` if not set |
| BR-49 | Favicon only updated when `metaFavicon` has a value |
| BR-50 | Property pages use imperative SEO; blog uses declarative (Helmet) |

---

## 23. UI/UX Design Principles

### 23.1 Mobile-First

All layouts are designed for mobile screens first, progressively enhanced for tablet and desktop. The bottom navigation bar on mobile replaces the top navigation bar to optimize thumb reach.

### 23.2 Performance Over Completeness

Content is shown immediately from cache. Background updates happen silently. Loading spinners only appear on the very first visit (no cache). This avoids blank screens.

### 23.3 Minimal Admin Friction

The admin interface is directly accessible from the property URL (`/{id}/admin`). No separate admin subdomain or login page is needed. The login flow (one Google popup) is as frictionless as possible.

### 23.4 Guest-Focused Clarity

Information is organized by guest need: "How do I get there?" → Access page. "How much will it cost?" → Pricing page / BookingWidget. "What are the rules?" → Rules page. Navigation labels support custom overrides to allow hosts to use language natural to their guests.

### 23.5 Platform Brand Flexibility

The theming system allows a host to present their property in a visual style consistent with their primary OTA platform (Airbnb red, Booking.com navy, Agoda teal), building visual trust with guests who arrive from those platforms.

---

## 24. Data Persistence Rules

### 24.1 Firestore Collections

| Collection | Document ID | Contents | Public Read | Admin Write |
|------------|-------------|----------|-------------|-------------|
| `properties` | `{propertyId}` | Full `PropertyData` JSON | Yes | Yes |
| `blogPosts` | `{postId}` | Full `BlogPost` JSON | Yes | Yes |
| `settings` | `listingsPage` | `SiteSettings` JSON | Yes | Yes |

### 24.2 LocalStorage Keys

| Key | Contents | Lifecycle |
|-----|----------|-----------|
| `cache_property_{propertyId}` | Serialized `PropertyData` | Invalidated on admin save |
| `cache_properties` | Array of property summaries | Invalidated on admin save |
| `app_language` | Language code string | Permanent (user preference) |

### 24.3 In-Memory State

| Variable | Contents | Lifecycle |
|----------|----------|-----------|
| `blockedDatesCache` | `Set<string>` of `yyyy-MM-dd` strings | Session only (cleared on page reload) |
| `currentUser` | Firebase User object | Session only |

### 24.4 Data Not Persisted

- iCal blocked dates (always re-fetched from OTA feeds on load).
- Admin form state (unsaved edits are lost on navigation).
- Blog search terms and filter state (reflected in URL params only).

---

## 25. Error Handling & Fallback Behavior

### 25.1 Firebase / Network Errors

| Scenario | Behavior |
|----------|---------|
| Firestore unavailable on first load | Falls back to `DEFAULT_DATA` (hardcoded Sachi House defaults) |
| Firestore unavailable on return visit | Renders from `localStorage` cache; silently retries |
| Firebase config invalid | Console error: "Please check your Firebase configuration: the client is offline." |
| Admin save fails | Error message shown in admin UI; data not updated locally |
| Admin save fails with `permission-denied` | Detailed error logged to console including auth state; error thrown to UI |

### 25.2 iCal Sync Errors

| Scenario | Behavior |
|----------|---------|
| All proxies fail for one feed | That feed is skipped silently |
| URL is a placeholder (`...`) | Skipped silently without attempting any fetch |
| Response is not valid iCal | Response is discarded; that feed contributes no blocked dates |

### 25.3 Routing Errors

| Scenario | Behavior |
|----------|---------|
| Property ID not found in Firestore | Falls back to `DEFAULT_DATA` |
| Blog post ID not found | Shows "Post not found" message with link back to blog |
| Unknown route | HashRouter shows nothing (no 404 page configured) |

### 25.4 Authentication Errors

| Scenario | Behavior |
|----------|---------|
| Google popup blocked by browser | Error caught and logged; `loginWithGoogle` returns `false` |
| Non-admin email | User immediately signed out; alert message shown |
| Token expired | `onAuthStateChanged` fires with `null`; admin UI hidden |
