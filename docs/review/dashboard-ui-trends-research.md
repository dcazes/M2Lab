# Dashboard UI Trends Research Brief
## React Rewrite of Self-Hosted Homelab Dashboard (gethomepage.dev inspired)

**Research period**: Current sources (2025-2026)
**Scope**: Dashboard/UI design trends, modern React stack, design references, log viewer UX

---

## 1. Top 5-7 Concrete Design Directions (Service Tiles + System Stats + Logs)

| # | Direction | Flag | Description |
|---|-----------|------|-------------|
| 1 | **Bento-grid KPI tiles with semantic status dots** | Mainstream | Tiles arranged in a 12-column CSS Grid with asymmetric spans (hero 4-6 cols, metric cards 2-3 cols); each tile shows a tiny colored status dot (green/amber/red) with tabular-nums values and inline sparklines — size communicates priority, not content volume. |
| 2 | **Responsible glassmorphism: subtle backdrop-filter on overlays only** | Mainstream | Glass surfaces limited to headers, modals, and sticky navigation; always paired with a 1px white-border at 20-40% opacity; pre-render solid fallback for Safari/older devices — heavy frosted blur on every card is out. |
| 3 | **Dark-first palette with near-black surfaces (#0F1419 vs #000)** | Mainstream | Pure black is avoided to reduce halation on OLED; dark mode designed first with semantic tokens (surface-1, accent-strong, accent-muted); light theme adapted from dark, not vice versa. |
| 4 | **Variable font system: Inter for body, JetBrains Mono for data, Plus Jakarta Sans for display** | Mainstream | Single-variable-font approach replaces 8 static files; Inter at 400/500/600 weights for UI, JetBrains Mono for all metric values/timestamps (tabular numerals), display headings in Jakarta Sans — typographic hierarchy communicates information class at a glance. |
| 5 | **Micro-interactions: 150-300ms cubic-bezier feedback, respect prefers-reduced-motion** | Mainstream | Every interactive element has default/hover/active/success states; durations 150-300ms for UI feedback; motion disabled entirely when user prefers reduced motion; no bouncy/spring animations. |
| 6 | **Edgy: Accent color sparingness — one semantic teal/emerald accent, never gradient soup** | Edgy | Instead of multi-color gradients, one carefully chosen accent color (e.g., teal at 500) appears only on healthy indicators, primary buttons, and active states; when it appears, it carries real significance (Cordum design system pattern). |
| 7 | **Edgy: Log viewer with virtualized monospace + level-coloring + autoscroll affordances** | Edgy | Virtualized list (react-window/virtuoso) rendering only visible lines; monospace font (JetBrains Mono/IBM Plex Mono) with per-level coloring (error=red, warn=amber, info=blue, debug=gray); pause/resume autoscroll with visible "jump to bottom" affordance; level chips toggle visibility. |

---

## 2. Recommended Stack Table

| Library | Version | Why | Alternative |
|---------|---------|-----|-------------|
| **React** | 19.2.4 | Latest stable; concurrent features, automatic batching, built-in start transitions; ecosystem-wide compatibility in 2026 | React 18 (legacy) |
| **Vite** | 8.x | Rust-based bundler (Rolldown) delivers 40-60% faster HMR/builds over Rollup; official React recommendation post-CRA deprecation (Feb 2025) | Create React App (deprecated) |
| **Tailwind CSS** | v4 | Utility-first with native CSS variables, built-in dark mode, JIT compilation; smallest bundle footprint; works natively with shadcn/ui | Tailwind CSS v3 (maintenance mode) |
| **shadcn/ui** | latest | Copy-paste components on Radix UI primitives; zero runtime dependencies; full code ownership; ~50KB gzipped bundle; fastest-growing React component library (42% usage, 80% positivity in State of React 2024) | MUI v6, Ant Design (heavier, CSS-in-JS) |
| **TanStack Query** | v5 | Server-state deduplication, stale-while-revalidate, background refetch, automatic cache invalidation; queryObserver + queryClient pattern eliminates useState+useEffect boilerboard; SSR-ready with HydrationBoundary | React Query v3 (last v4/v5), Redux Toolkit (overkill for state) |
| **Framer Motion** | 12.x | Production-grade animation library; cubic-easing timing, preserveAspectRatio, gesture support; respects prefers-reduced-motion; stagger children, spring/physics when needed but capped | React Spring (maintenance), CSS-only animations (limited) |
| **Lucide** | 1.x | Tree-shakable icon set; ~350 icons; consistent style; no SVGs bundled unused; default for shadcn/ui | Feather Icons, Font Awesome (heavier, older design language) |
| **Recharts** | 3.x | Composable chart primitives; works seamlessly with shadcn theming via CSS variables; ~135KB full, ~50KB selective; covers line/bar/pie/area/sparklines | Chart.js (simpler but less composable), ECharts (heavier, ~273KB) |
| **react-virtuoso** or **react-window** | 1.5+ | Virtualized list rendering for log viewers; smooth at 10k+ lines; minimal DOM footprint (~20-40 rows); essential for performance | infinite scroll list (freezes at 5k+ lines) |
| **next-themes** | 0.4.x | System preference detection, instant light/dark toggle via class attribute; works with shadcn CSS variable system | manual CSS class toggling, no persistence |

---

## 3. Named References (What to Steal From It)

| # | Reference | What to Steal |
|---|-----------|--------------|
| 1 | **Cordum design system** (cordum-io/cordum) | Status-first design: default states are quiet, alerts pulse only when needed; OKLCH-based color space for perceptual uniformity; three typographic voices (Jakarta Sans, Inter, JetBrains Mono); teal accent appears only for healthy states — "when teal appears, it carries real significance." |
| 2 | **Glance dashboard** (glanceapp/glance) | Information-dense widget layout in single Go binary; dark theme out of the box; YAML config; ~50MB memory footprint; widget categories (RSS, weather, markets, Reddit); "glance" pattern — quick scan, not app launcher. |
| 3 | **shadcn/ui dashboard blocks** (shadcn.com/blocks) | Copy-paste KPI tile grids, status dots, sparkline cards, data tables; Tailwind v4 + CSS variables for theming; ChartContainer wrapper that auto-adapts dark mode; responsive grid with staggered entrance animations; component ownership model. |
| 4 | **Homarr dashboard** (homarr.dev) | Drag-and-drop GUI configuration; 11K+ built-in icons; OIDC/LDAP auth; multi-board isolation; real-time widget updates via WebSockets; "GUI-first" approach vs YAML config. |
| 5 | **TypeUI Dashboard Skill File** (typeui.sh/design-skills/dashboard) | Semantic token system (primary #0C5CAB, success #10B981, warning #F59E0B, danger #EF4444, surface #09090B); 8pt baseline grid; component spec with explicit states (default, hover, focus, disabled, loading, error); accessibility-first (WCAG AA, focus visible, reduced motion). |

---

## 4. Log Viewer Pattern Checklist

- [ ] **Virtualized rendering** — only visible lines in DOM (react-window/virtuoso); smooth at 10k+ lines
- [ ] **Monospace font** — JetBrains Mono or IBM Plex Mono with tabular numerals for aligned data
- [ ] **Per-level coloring** — error (red accent + left bar), warn (amber), info (blue), debug (muted); color paired with text label, never color alone
- [ ] **Level filter chips** — toggle buttons with `aria-pressed`; multi-select Ctrl+Click to show/hide levels; count badges on chips
- [ ] **Auto-scroll (follow-tail)** — default sticks to bottom; scrolling up detaches; "Jump to bottom" button appears with new-line count; re-attaches when clicked or when scrolling to bottom
- [ ] **Pause/resume affordance** — explicit button/toggle; when paused, autoscroll disabled; buffered line count visible
- [ ] **Search with highlight** — substring search with regex optional; matched substrings highlighted; `useDeferredValue` keeps typing responsive; results count shown
- [ ] **Timestamp toggle** — optional leading timestamps; persisted in localStorage/URL
- [ ] **Word wrap toggle** — single-line mode (horizontal scroll) vs multi-line (auto-wrap); row height adjusts automatically
- [ ] **Source tags** — optional badge per entry showing component/service origin
- [ ] **Copy-to-clipboard** — on hover or selection; full raw line or formatted view
- [ ] **Pause on user scroll** — autoscroll pauses when user scrolls up; resumes when user returns to bottom
- [ ] **Reduced-motion support** — all animations respect `prefers-reduced-motion`; transitions disabled or simplified
- [ ] **Empty state** — friendly message when no logs loaded; skeleton placeholder during fetch

---

## 5. Source URLs for Key Claims

| Topic | Source |
|-------|--------|
| UI Trends 2026: bento grids, glassmorphism, dark mode, micro-interactions | https://mediaplus.com.sg/ui-trends/ (2026-05-05) |
| Dashboard design system: typography, color, spacing tokens | https://www.typeui.sh/design-skills/dashboard (2026-03-27) |
| React dashboard stack: Vite 8 + React 19 + shadcn/ui + TanStack Query + Recharts | https://www.usedatabrain.com/how-to/create-react-dashboard (2026-04-29) |
| shadcn/ui + Tailwind v4 + React 19 adoption patterns | https://github.com/Kiranism/next-shadcn-dashboard-starter (2026) |
| Bento grid tile sizing hierarchy (hero 4-6 cols, metric cards 2-3 cols) | https://www.orbix.studio/blogs/bento-grid-dashboard-design-aesthetics (2026-07-21) |
| Cordum design system: status-first, OKLCH, three typographic voices | https://github.com/cordum-io/cordum/blob/main/cordum-dashboard-design-language.md |
| Glance dashboard: self-hosted, Go binary, widget categories | https://github.com/glanceapp/glance (2026-05-30) |
| Log viewer virtualization + level coloring + autoscroll patterns | https://www.entangle-ui.dev/components/feedback/log-view/ |
| Tailwind CSS v4 features and shadcn/ui compatibility | https://www.usedatabrain.com/how-to/create-react-dashboard (2026-04-29) |
| Design trends 2026 separation: mainstream vs experimentation | https://rajeshrnair.com/blog/design/ui-ux/ui-design-trends-2026-bento-grids-glassmorphism (2026-02-16) |
| Variable fonts: Inter, Geist, Manrope for modern UI | https://midrocket.com/en/guides/ui-design-trends-2026/ (2026-03-12) |

---
*Research compiled for homelab dashboard React rewrite planning. All sources accessed 2026. Flags "mainstream" = currently shipping in production products at scale; "edgy" = niche/early-adopter patterns with higher risk/reward.*