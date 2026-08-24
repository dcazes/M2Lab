# React Dashboard (ctl-web-next) — UI/UX Improvement Plan

This document outlines a phased plan to make the OmniLab React control dashboard more beautiful, functional, and delightful.

---

## Phase 1: Visual Polish & Design System (Week 1–2)

### 1.1 Design Tokens & Theme
- **Color palette**: Define semantic tokens (primary, surface, text, border, success/warning/error) in `src/theme/tokens.ts` or Tailwind config.
- **Dark mode first**: Support `prefers-color-scheme` + manual toggle persisted to `localStorage`.
- **Spacing scale**: 4px base unit (4, 8, 12, 16, 24, 32, 48).
- **Typography**: Inter or system font stack; consistent scale (h1–h4, body, caption, mono).
- **Border radius**: 4px (sm), 8px (md), 12px (lg), full (pills).
- **Shadows/elevation**: 3 levels (subtle, card, modal).

### 1.2 Component Library (shadcn/ui or Radix + Tailwind)
- Migrate existing raw HTML/CSS to composed components:
  - `Button`, `Card`, `Badge`, `Avatar`, `Tooltip`, `DropdownMenu`, `Dialog`, `Tabs`, `Select`, `Switch`, `Progress`, `Skeleton`, `Toast`.
- Use **class-variance-authority (CVA)** for variant props.

### 1.3 Layout & Shell
- Persistent left sidebar (collapsible to icon rail) with service categories.
- Top bar: search (⌘K), notifications, user avatar, theme toggle.
- Responsive breakpoint: sidebar drawer on < 768px.

---

## Phase 2: Service Cards & Grouping (Week 2–3)

### 2.1 Service Card Redesign
- **States**: Running (green pulse), Stopped (gray), Degraded (amber), Unknown (muted).
- **Content**: Icon, name, one-line description, status badge, port/tailnet link, quick actions (logs, restart, open).
- **Hover**: Subtle elevation, show "Open in new tab" affordance.

### 2.2 Category Sections
- Sticky section headers with service count badge.
- Collapsible groups (persist open/closed in localStorage).
- Empty state illustration when category has no services.

### 2.3 Grouping Logic (already implemented)
- Verify `GROUP_ORDER` and `CATEGORY_TO_GROUP` in `src/lib/types.ts` match services.yaml.
- Add "Ungrouped" fallback for uncategorized services.

---

## Phase 3: Interactions & Micro-animations (Week 3)

### 3.1 Motion (Framer Motion)
- Card entrance: staggered fade + slide up (100ms stagger).
- State transitions: pulse on status change, smooth color morph.
- Sidebar collapse: width + icon opacity transition.
- Dialog/sheet: spring-based enter/exit.

### 3.2 Feedback
- Optimistic UI for start/stop/restart (show pending, confirm on API response).
- Toast notifications for success/failure (top-right, auto-dismiss 4s).
- Skeleton loaders for initial fetch.

---

## Phase 4: Functionality & Power Features (Week 4+)

### 4.1 Command Palette (⌘K)
- Fuzzy search services, actions, settings.
- Keyboard-first: navigate with arrows, enter to execute.

### 4.2 Service Detail Drawer
- Click card → slide-over panel with:
  - Real-time logs (WebSocket tail)
  - Resource usage charts (CPU, RAM, GPU via Beszel API)
  - Environment variables (read-only, masked secrets)
  - Compose file viewer
  - Backup history & manual trigger

### 4.3 Bulk Operations
- Multi-select checkboxes (Shift+click range).
- Bulk start/stop/restart with confirmation dialog.
- "Start all in category" button in section header.

### 4.4 Real-time Updates
- WebSocket/SSE from `homelab-ctl` for:
  - Container status changes
  - Log streaming
  - Backup progress
- Fallback to 15s polling if WS unavailable.

### 4.5 Settings & Personalization
- Per-service: custom icon, display name override, hide from dashboard.
- Dashboard density: Compact / Comfortable / Spacious.
- Auto-refresh interval picker.

---

## Phase 5: Accessibility & Quality (Ongoing)

- **WCAG AA**: Contrast ratios, focus visible, ARIA labels, semantic HTML.
- **Keyboard nav**: Tab order, focus trap in dialogs, escape to close.
- **Screen readers**: Live region for status toasts, proper heading hierarchy.
- **Reduced motion**: Respect `prefers-reduced-motion`.
- **Internationalization**: i18n keys from day one (even if only EN).

---

## Phase 6: Advanced / Nice-to-Have

- **Service dependency graph**: Visual DAG (frontend-net → backend-net).
- **Log search & highlight**: In-drawer regex filter, error highlighting.
- **Compose diff viewer**: Show pending changes before `make update`.
- **Mobile PWA**: Installable, offline shell, push notifications for critical alerts.
- **Custom dashboards**: User-defined grids, pinned services, markdown widgets.

---

## Technical Debt & Migration Notes

- **Current stack**: Next.js 14 (App Router), React 18, Tailwind CSS.
- **State**: React Query (TanStack Query) for server state; Zustand for UI state.
- **API**: `ctl/app.py` FastAPI → `/api/services`, `/api/services/{id}/logs`, `/api/services/{id}/action`.
- **WebSocket**: Add `/ws/services` endpoint in `ctl/app.py` for real-time.
- **Icons**: Use `lucide-react` (already in deps) consistently.

---

## Acceptance Criteria for "Beautiful & Functional"

| Criterion | Target |
|-----------|--------|
| Lighthouse Performance | ≥ 95 |
| Lighthouse Accessibility | 100 |
| First Contentful Paint | < 1.2s |
| Time to Interactive | < 2.5s |
| Bundle size (gz) | < 150 KB |
| Zero console errors/warnings | ✅ |
| Works at 320px & 1920px | ✅ |
| Dark mode default | ✅ |
| All interactions < 100ms response | ✅ |

---

## Delegation Strategy

| Area | Specialist |
|------|------------|
| Design tokens, component library, visual polish | `@designer` |
| Motion, micro-interactions, Framer Motion | `@designer` |
| Command palette, keyboard shortcuts | `@fixer` (bounded) |
| WebSocket integration, real-time logs | `@fixer` |
| Service detail drawer, bulk ops | `@fixer` |
| Accessibility audit & fixes | `@fixer` + `@oracle` review |
| Performance profiling & bundle optimization | `@fixer` |

---

## Next Steps

1. **Designer kickoff**: `@designer` creates design tokens, component specs, and high-fidelity mockups for Service Card, Sidebar, and Detail Drawer.
2. **Implementation sprint**: `@fixer` builds component library + layout shell in parallel.
3. **Integration**: Wire real API, add React Query, implement optimistic mutations.
4. **Polish**: Motion, accessibility, responsive testing.
5. **Ship**: Feature flag rollout, monitor Lighthouse scores.