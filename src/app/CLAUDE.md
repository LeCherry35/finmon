## Responsive design — app shell

- **Breakpoint**: Tailwind v4's default `md:` (≥768px) is the single split point between mobile and desktop. No `sm:`/`lg:` variants are used in the app shell.
- **Navigation**: top `<nav>` in `src/app/layout.tsx` shows the logo at all sizes; route links live in `src/components/NavLinks.tsx` and are `hidden md:contents`. Mobile uses `src/components/MobileBottomNav.tsx` — a fixed bottom tab bar (`md:hidden`) that reads the same route list from `src/lib/nav.ts`. The shared list has `{ href, label, short }`; bottom-nav uses `short` to keep text inside the per-item width budget on 360px screens, full `label` goes on `aria-label`.
- **Body padding**: `<main>` has `pb-[calc(env(safe-area-inset-bottom,0px)+5rem)] md:pb-0` so mobile content clears the bottom nav (including the iOS home indicator).
- **Safe area**: `src/app/globals.css` defines a `safe-pb` Tailwind v4 utility (`@utility safe-pb`) — used on the bottom nav and the bottom sheet so they sit above the iOS home indicator.
- **Page headers**: each page wraps title + `FilterPanel` in `flex flex-col items-start gap-2 md:flex-row md:items-center md:gap-3` so the filter pill stacks under the title on mobile. Page wrappers use `py-6 md:py-10` to tighten top whitespace on mobile.
