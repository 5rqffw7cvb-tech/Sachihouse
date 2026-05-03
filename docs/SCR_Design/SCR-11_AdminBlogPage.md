# Screen Design Document — SCR-11: Blog Admin Page

**Screen ID:** SCR-11  
**Screen Name:** Blog Admin / CMS  
**Route:** `/blog/admin` (also `/blog/admin?edit={postId}`)  
**File:** `pages/AdminBlogPage.tsx`  
**Layout Wrapper:** None (standalone with `pt-20`)

---

## 1. Screen Overview

A three-state admin CMS for managing blog posts. Requires Google Sign-In authentication. Transitions sequentially from login gate → post list → post editor. Supports deep-linking directly to the editor via `?edit={postId}` URL param.

---

## 2. View States Overview

```
URL: /blog/admin

  ┌──────────────────┐      Auth OK      ┌────────────────────┐
  │  VIEW 1: LOGIN   │ ────────────────► │  VIEW 2: POST LIST │
  │  (Not signed in) │                   │  (Signed in)       │
  └──────────────────┘                   └────────────────────┘
                                                   │
                                           Click "New Post"
                                           or "Edit" button
                                                   │
                                                   ▼
                                         ┌──────────────────────┐
                                         │  VIEW 3: POST EDITOR │
                                         │  (Create or Edit)    │
                                         └──────────────────────┘
```

---

## 3. View 1: Login Gate

```
┌──────────────────────────────────────┐
│                                      │
│  [pt-20 min-h-screen bg-gray-50]     │
│                                      │
│  ┌──────────────────────────────┐    │
│  │  [Lock icon  48×48]          │    │
│  │  Blog Admin Access (h2)      │    │
│  │  "Sign in with Google..."    │    │
│  │                              │    │
│  │  [ G  Login with Google ]    │    │
│  └──────────────────────────────┘    │
│                                      │
└──────────────────────────────────────┘
```

| Element | Spec |
|---------|------|
| Page background | `min-h-screen bg-gray-50 flex items-center justify-center` |
| Card | `bg-white rounded-2xl shadow-lg p-8 max-w-sm w-full mx-4` |
| Lock icon | `Lock` from lucide-react, 48×48, centered, `text-gray-400` |
| Title | "Blog Admin Access" — `text-2xl font-bold text-gray-900` |
| Subtitle | "Sign in with your Google account to manage blog posts" |
| Login button | Full-width, `bg-white border border-gray-200 hover:bg-gray-50`, Google `G` icon + "Login with Google" |
| Login action | `signInWithGoogle()` from `services/auth.ts` |

---

## 4. View 2: Post List

```
┌──────────────────────────────────────────────────────────────┐
│  TOP NAV BAR (TopNavBar component)                           │
├──────────────────────────────────────────────────────────────┤
│  [pt-20 max-w-5xl mx-auto px-4]                              │
│                                                              │
│  HEADER ROW                                                  │
│  "Blog Manager"  (text-3xl bold)    [View Blog] [+ New Post] │
│                                                              │
│  POSTS TABLE                                                 │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  Title              │ Category │ Date     │  Actions    │ │
│  │─────────────────────────────────────────────────────────│ │
│  │  Post Title 1        │          │          │            │ │
│  │  ┌─────────────────┐ │ Sightsee │ 2025/01  │ [✏] [🗑]  │ │
│  │  │  [FEATURED]     │ │          │          │            │ │
│  │  └─────────────────┘ │          │          │            │ │
│  │─────────────────────────────────────────────────────────│ │
│  │  Post Title 2        │ Tips     │ 2024/12  │ [✏] [🗑]  │ │
│  │─────────────────────────────────────────────────────────│ │
│  │  Post Title 3        │ Food     │ 2024/11  │ [✏] [🗑]  │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  EMPTY STATE (when no posts)                                 │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  [center, py-12]                                        │ │
│  │  No blog posts yet.                                     │ │
│  │  [Seed Mock Posts]  (dev/demo utility button)           │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 4.1 Header Row

| Element | Spec |
|---------|------|
| Title | "Blog Manager" — `text-3xl font-bold` |
| View Blog link | `→ View Blog` link to `/blog` |
| New Post button | Blue `+ New Post` button; opens View 3 with blank editor |

### 4.2 Posts Table

| Column | Content |
|--------|---------|
| **Title** | Post title; if `post.featured === true` → inline "FEATURED" yellow badge |
| **Category** | Category name pill |
| **Date** | Formatted publication date |
| **Actions** | ✏ Edit icon (opens View 3) + 🗑 Delete icon (confirm + delete) |

| Row style | Spec |
|-----------|------|
| Hover | `hover:bg-gray-50` |
| Table border | `divide-y divide-gray-100` |

### 4.3 Empty State

| Element | Spec |
|---------|------|
| Container | `text-center py-12 text-gray-500` |
| Message | "No blog posts yet." |
| Seed button | "Seed Mock Posts" — calls `handleSeed()` which inserts sample data into Firestore; useful for demo/dev environments |

---

## 5. View 3: Post Editor

```
┌──────────────────────────────────────────────────────────────┐
│  TOP NAV BAR                                                 │
├──────────────────────────────────────────────────────────────┤
│  [pt-20 max-w-3xl mx-auto px-4]                              │
│                                                              │
│  EDITOR HEADER ROW                                           │
│  ← Back to Posts               [💾 Save Post]               │
│  "New Post" / "Edit Post" (h2)                               │
│                                                              │
│  FORM FIELDS                                                 │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Title *                                               │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │ Post title...                                    │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  │                                                        │  │
│  │  ┌────────────────────┐  ┌────────────────────────┐   │  │
│  │  │ Category *         │  │ Image URL              │   │  │
│  │  │ ┌────────────────┐ │  │ ┌────────────────────┐ │   │  │
│  │  │ │ [select menu]  │ │  │ │ https://...        │ │   │  │
│  │  │ └────────────────┘ │  │ └────────────────────┘ │   │  │
│  │  └────────────────────┘  └────────────────────────┘   │  │
│  │                                                        │  │
│  │  Excerpt *                                             │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │                                                  │  │  │
│  │  │ (textarea h-24)                                  │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  │                                                        │  │
│  │  Content * (Markdown)                                  │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │                                                  │  │  │
│  │  │ (textarea h-96, font-mono, monospace)            │  │  │
│  │  │                                                  │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  │  Hint: "Supports Markdown formatting"                  │  │
│  │                                                        │  │
│  │  [☑] Featured Post                                     │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 5.1 Editor Header

| Element | Spec |
|---------|------|
| Back button | "← Back to Posts" — returns to View 2 (sets `selectedPost = null`) |
| Mode title | "New Post" (create) or "Edit Post" (editing) |
| Save button | "Save Post" — calls `handleSave()`, writes to Firestore |

### 5.2 Form Fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Title | `text input` | Yes | Full-width |
| Category | `select` dropdown | Yes | Half-width (grid-cols-2) |
| Image URL | `text input` | No | Half-width (grid-cols-2); `https://...` placeholder |
| Excerpt | `textarea` | Yes | `h-24`, brief description for listing cards |
| Content | `textarea` | Yes | `h-96`, `font-mono`, Markdown |
| Featured | `checkbox` | No | "Featured Post" label; marks post as hero on listing page |

**Categories available in select:** Derived from existing post categories + configurable list (e.g., "Sightseeing", "Tips", "Food", "Events", "Culture").

### 5.3 Save Behavior

| Case | Action |
|------|--------|
| New post (no ID) | `blogService.createPost(formData)` → Firestore `add` |
| Existing post (has ID) | `blogService.updatePost(id, formData)` → Firestore `update` |
| After save | Navigates back to View 2 (post list) |
| Validation failure | Inline field error messages (required fields) |

---

## 6. Deep-Link Behavior

URL `/blog/admin?edit={postId}`:
1. Component mounts
2. If authenticated: fetch post with that ID from Firestore
3. Pre-populate editor form with post data
4. Show View 3 directly (skip View 2)

This is used by the "Edit Post" button on SCR-10 (Blog Post Detail).

---

## 7. States

| State | View Shown |
|-------|-----------|
| Not authenticated | View 1: Login gate |
| Authenticated, no edit param | View 2: Post list |
| Authenticated, `?edit=X` | View 3: Editor (pre-filled) |
| Authenticated, "New Post" clicked | View 3: Editor (blank) |
| Authenticated, "Edit" row action | View 3: Editor (pre-filled) |

---

## 8. Navigation Flows

```
SCR-11 Admin Blog Page
  │
  ├── [View 1] Login → Google OAuth → View 2
  ├── [View 2] "New Post" → View 3 (blank)
  ├── [View 2] "✏ Edit" → View 3 (pre-filled)
  ├── [View 2] "🗑 Delete" → Confirmation → delete → stay View 2
  ├── [View 2] "View Blog" → SCR-09 Blog Listing (/blog)
  ├── [View 3] "Save Post" → save to Firestore → View 2
  └── [View 3] "← Back to Posts" → View 2 (no save)
```

---

## V2 Change Request Addendum (2026-05-03)

### Backend + DB Integration

- Replace direct Firestore CRUD with backend Blog API (`/api/v1/blog`).
- Implement server-side draft/publish workflow support and audit logs.

### Role Updates

- Admin can create/edit/delete all posts.
- Host can create/edit only their own posts when delegated by Admin policy.

### Authentication Update

- Replace Google-popup-only gate with backend-authenticated session/JWT flow.
