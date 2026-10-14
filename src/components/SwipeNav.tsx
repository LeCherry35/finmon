"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useFilterQuery } from "@/lib/filter-memory";
import { FILTER_PAGES, NAV_LINKS } from "@/lib/nav";

/** -1 = previous tab (swipe right), 1 = next tab (swipe left). */
type Dir = -1 | 1;

const LOCK_PX = 10; // movement before the gesture picks an axis
const EDGE_PX = 20; // screen edges belong to the OS back/forward gesture
const RESISTANCE = 0.3; // drag factor past the first/last tab
const SLIDE_MS = 200;
const IGNORE = "input, textarea, select, [contenteditable], [data-no-swipe]";

/** The bottom-nav tab `dir` steps away from `pathname`, with the remembered
 *  filter query on filter pages; null off the tabs or past either end. */
export function swipeTarget(pathname: string, dir: Dir, filterQuery = ""): string | null {
  const i = NAV_LINKS.findIndex((l) => l.href === pathname);
  if (i < 0) return null;
  const next = NAV_LINKS[i + dir];
  if (!next) return null;
  return FILTER_PAGES.has(next.href) ? next.href + filterQuery : next.href;
}

/** A release navigates when dragged past a quarter of the screen, or flicked. */
export function shouldCommit(dx: number, velocity: number, width: number): boolean {
  const dist = Math.abs(dx);
  return dist > width * 0.25 || (Math.abs(velocity) > 0.5 && dist > 40);
}

/** True when something between `el` and `root` scrolls sideways itself. */
function inHorizontalScroller(el: Element | null, root: Element): boolean {
  for (; el && el !== root; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth) {
      const ox = getComputedStyle(el).overflowX;
      if (ox === "auto" || ox === "scroll") return true;
    }
  }
  return false;
}

/** Mobile-only: swiping the page sideways moves to the neighbouring bottom-nav
 *  tab. The page follows the finger, then slides off and the next one slides in.
 *  Touches in form fields, `[data-no-swipe]`, sideways scrollers or while a
 *  modal is open are left alone. */
export default function SwipeNav({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const filterQuery = useFilterQuery();
  const ref = useRef<HTMLDivElement>(null);
  // Read by the listeners, which are attached once.
  const live = useRef({ pathname, filterQuery, router });
  useEffect(() => {
    live.current = { pathname, filterQuery, router };
  });
  const arriving = useRef<Dir | null>(null); // set while a swiped-to page loads

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mobile = window.matchMedia?.("(max-width: 767px)");
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)");

    let g: {
      x: number;
      y: number;
      t: number;
      axis: "x" | "y" | null;
      dx: number;
      prefetched: Set<string>;
    } | null = null;

    const set = (transform: string, animate: boolean) => {
      el.style.transition = animate && !reduced?.matches ? `transform ${SLIDE_MS}ms ease-out` : "";
      // "" rather than translateX(0): a transform would turn the wrapper into
      // the containing block of every position:fixed child (the FAB, sheets).
      el.style.transform = transform;
    };

    const onStart = (e: TouchEvent) => {
      g = null;
      if (arriving.current !== null || !mobile?.matches || e.touches.length !== 1) return;
      const { pathname } = live.current;
      if (!NAV_LINKS.some((l) => l.href === pathname)) return;
      const t = e.touches[0];
      const target = e.target instanceof Element ? e.target : null;
      if (t.clientX < EDGE_PX || t.clientX > window.innerWidth - EDGE_PX) return;
      if (target?.closest(IGNORE) || inHorizontalScroller(target, el)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      g = { x: t.clientX, y: t.clientY, t: e.timeStamp, axis: null, dx: 0, prefetched: new Set() };
    };

    const onMove = (e: TouchEvent) => {
      if (!g) return;
      const t = e.touches[0];
      const dx = t.clientX - g.x;
      const dy = t.clientY - g.y;
      if (!g.axis) {
        if (Math.abs(dx) < LOCK_PX && Math.abs(dy) < LOCK_PX) return;
        g.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      }
      if (g.axis === "y") {
        g = null;
        return;
      }
      e.preventDefault();
      const { pathname, filterQuery, router } = live.current;
      const href = swipeTarget(pathname, dx < 0 ? 1 : -1, filterQuery);
      if (href && !g.prefetched.has(href)) {
        g.prefetched.add(href);
        router.prefetch(href);
      }
      g.dx = href ? dx : dx * RESISTANCE;
      set(`translateX(${g.dx}px)`, false);
    };

    const onEnd = (e: TouchEvent) => {
      if (!g) return;
      const { dx, axis, t } = g;
      g = null;
      if (axis !== "x") return;
      const { pathname, filterQuery, router } = live.current;
      const dir: Dir = dx < 0 ? 1 : -1;
      const href = swipeTarget(pathname, dir, filterQuery);
      const velocity = dx / Math.max(1, e.timeStamp - t);
      if (!href || !shouldCommit(dx, velocity, window.innerWidth)) {
        set("", true);
        return;
      }
      arriving.current = dir;
      set(`translateX(${-dir * 100}%)`, true);
      router.push(href);
      // If the navigation never lands, don't leave the page off-screen.
      window.setTimeout(() => {
        if (arriving.current !== null && live.current.pathname === pathname) {
          arriving.current = null;
          set("", true);
        }
      }, 4000);
    };

    const onCancel = () => {
      if (g?.axis === "x") set("", true);
      g = null;
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onCancel);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onCancel);
    };
  }, []);

  // A new page after a swipe slides in from the side it was swiped from.
  useLayoutEffect(() => {
    const el = ref.current;
    const dir = arriving.current;
    if (!el) return;
    arriving.current = null;
    el.style.transition = "";
    el.style.transform = "";
    el.style.opacity = "";
    if (dir === null || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    el.style.transform = `translateX(${dir * 30}%)`;
    el.style.opacity = "0";
    const frame = requestAnimationFrame(() => {
      el.style.transition = `transform ${SLIDE_MS}ms ease-out, opacity ${SLIDE_MS}ms ease-out`;
      el.style.transform = "";
      el.style.opacity = "";
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname]);

  // pan-y keeps vertical scrolling native and hands sideways drags to us. Only
  // on the tabs: touch-action applies to descendants, so on /assistant it would
  // block sideways-scrolling tables.
  const onTab = NAV_LINKS.some((l) => l.href === pathname);
  return (
    <div ref={ref} className={onTab ? "touch-pan-y md:touch-auto" : undefined}>
      {children}
    </div>
  );
}
