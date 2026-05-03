# Screen Design Document — SCR-10: Blog Post Detail Page

**Screen ID:** SCR-10  
**Screen Name:** Blog Post Detail  
**Route:** `/blog/:id`  
**File:** `pages/BlogPostPage.tsx`  
**Layout Wrapper:** `GlobalLayout` (TopNavBar + Footer)

---

## 1. Screen Overview

Displays the full content of a single blog post rendered from Markdown. Includes a hero image, metadata, and styled prose. Shares a two-column layout with a sidebar on desktop. Admins can access the edit view via a contextual button.

---

## 2. Wireframe — Desktop

```
┌──────────────────────────────────────────────────────────────┐
│  TOP NAV BAR (GlobalLayout)                                  │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  TOP BAR  (border-b, sticky if implemented)                  │
│  ← Back to Blog                        [✏ Edit Post] (admin)│
│                                                              │
│  ┌─────────────────────────────────┐  ┌────────────────────┐│
│  │  MAIN CONTENT (flex-1)          │  │  BlogSidebar       ││
│  │                                 │  │  (hidden < lg)     ││
│  │  [CATEGORY BADGE]  · Date       │  │  Categories        ││
│  │                                 │  │  Recent Posts      ││
│  │  POST TITLE (H1)                │  │                    ││
│  │  (text-4xl→text-5xl, font-bold, │  └────────────────────┘│
│  │   tight tracking)               │                        │
│  │                                 │                        │
│  │  HERO IMAGE                     │                        │
│  │  aspect-[21/9] (md: [2.5/1])    │                        │
│  │  rounded-2xl, shadow-xl         │                        │
│  │                                 │                        │
│  │  MARKDOWN CONTENT               │                        │
│  │  (prose-lg, custom styles)      │                        │
│  │  • H2 headings: text-2xl        │                        │
│  │  • H3 headings: text-xl         │                        │
│  │  • Body: text-lg / 18px         │                        │
│  │  • Blockquote: blue-50 border   │                        │
│  │  • Code: gray-100 bg            │                        │
│  │  • Links: text-blue-600         │                        │
│  │  • Images: rounded-xl           │                        │
│  │                                 │                        │
│  └─────────────────────────────────┘                        │
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
│  ← Back to Blog         │
│  [✏ Edit Post] (admin)  │
├─────────────────────────┤
│  [CATEGORY BADGE] · Date│
│                         │
│  POST TITLE (H1)        │
│  (text-3xl, tight)      │
│                         │
│  HERO IMAGE             │
│  aspect-[21/9]          │
│  rounded-2xl            │
│                         │
│  MARKDOWN CONTENT       │
│  (prose-lg)             │
│  ...                    │
│                         │
│  (No sidebar on mobile) │
└─────────────────────────┘
```

---

## 4. UI Components

### 4.1 Top Navigation Bar

| Element | Spec |
|---------|------|
| Container | `flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-white sticky top-0 z-10` |
| Back button | `← Back to Blog` — navigates to `/blog` |
| Edit Post button | Visible only when user is authenticated as admin; `button` with pencil icon, navigates to `/blog/admin?edit={post.id}` |

### 4.2 Category Badge + Date Row

| Element | Spec |
|---------|------|
| Category badge | Colored pill, same styling system as SCR-09 |
| Separator | `·` middle dot |
| Publication date | `text-sm text-gray-500` formatted date (`MMMM d, yyyy`) |

### 4.3 Post Title (H1)

| Attribute | Value |
|-----------|-------|
| Font size | `text-3xl` (mobile) → `text-4xl` (md+) → `text-5xl` (lg+) |
| Font weight | `font-extrabold` |
| Color | `text-gray-900` |
| Letter spacing | `tracking-tight` |
| Line height | `leading-tight` |

### 4.4 Hero Image

| Attribute | Value |
|-----------|-------|
| Aspect ratio | `aspect-[21/9]` (mobile) → `aspect-[2.5/1]` (md+) |
| Object fit | `object-cover` |
| Border radius | `rounded-2xl` |
| Shadow | `shadow-xl` |
| Loading | `loading="lazy"` |
| Alt text | Post title |
| Source | `post.imageUrl` |

### 4.5 Markdown Content Area

Rendered by `react-markdown` v10 with custom component overrides.

| Prose Style | Value |
|-------------|-------|
| Base class | `prose prose-lg max-w-none` |
| Body text color | `prose-gray` / `text-gray-700` |
| Font size (body) | 18px (`prose-lg`) |
| Link color | `prose-a:text-blue-600 prose-a:hover:text-blue-800` |

**Heading customization:**

| Heading | Font size | Color |
|---------|-----------|-------|
| `h2` | `text-2xl font-bold` | `text-gray-900` |
| `h3` | `text-xl font-semibold` | `text-gray-900` |
| `h4` | `text-lg font-semibold` | `text-gray-900` |

**Block elements:**

| Element | Style |
|---------|-------|
| Blockquote | `border-l-4 border-blue-500 bg-blue-50 pl-4 py-2 italic text-gray-700` |
| Code (inline) | `bg-gray-100 px-1.5 py-0.5 rounded text-sm font-mono text-gray-800` |
| Code (block) | `bg-gray-900 text-gray-100 rounded-xl p-6 overflow-x-auto` |
| Images | `rounded-xl shadow-md` |

### 4.6 BlogSidebar

| Attribute | Spec |
|-----------|------|
| Visibility | Hidden below `lg` breakpoint (`hidden lg:block`) |
| Width | Fixed sidebar in flex layout |
| Position | Right side of flex row |
| Content | Categories list + Recent Posts list |

---

## 5. States

| State | Display |
|-------|---------|
| Post found | Full article layout |
| Post not found (invalid `:id`) | "Post not found" centered message + "Return to Blog" link button |
| Admin authenticated | "Edit Post" button visible in top bar |
| Non-admin / unauthenticated | "Edit Post" button hidden |
| Post has no hero image | Hero image element not rendered |

### Not Found State Wireframe

```
┌──────────────────────────────────────┐
│  [center, py-24]                     │
│  Post not found  (text-2xl)          │
│                                      │
│  [Return to Blog]  (blue button)     │
└──────────────────────────────────────┘
```

---

## 6. Responsive Behavior

| Element | Mobile | Desktop (`lg+`) |
|---------|--------|-----------------|
| Layout | Single column | Two-column flex (main + sidebar) |
| BlogSidebar | Hidden | Visible right column |
| H1 font size | `text-3xl` | `text-4xl` / `text-5xl` |
| Hero aspect ratio | `aspect-[21/9]` | `aspect-[2.5/1]` |

---

## 7. SEO (react-helmet-async)

| Tag | Value |
|-----|-------|
| `<title>` | `{post.title} – SachiHouse78 Blog` |
| `og:title` | `{post.title}` |
| `og:description` | `{post.excerpt}` |
| `og:image` | `{post.imageUrl}` |
| `og:type` | `article` |
| `article:published_time` | `{post.date}` |

---

## 8. Navigation Flows

```
SCR-10 Blog Post Detail
  │
  ├── "← Back to Blog" → SCR-09 Blog Listing
  ├── BlogSidebar category click → SCR-09 (?category=X)
  ├── BlogSidebar recent post click → SCR-10 (different post)
  ├── [Admin] "Edit Post" → SCR-12 Admin Blog Page (?edit={id})
  ├── Post not found → SCR-09 Blog Listing ("Return to Blog")
  └── TopNavBar home → SCR-01 Listings Page
```

---

## V2 Change Request Addendum (2026-05-03)

### Backend + DB Integration

- Post detail must be fetched from `GET /api/v1/blog/{id}`.
- Edit workflow should call authenticated blog update endpoint.
- Rendering remains markdown-based but sanitation must be enforced server-side and client-side.

### Role Updates

- Edit button visibility depends on RBAC response (Admin always; Host if authoring policy allows).
