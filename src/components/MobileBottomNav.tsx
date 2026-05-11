"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_LINKS, type NavHref } from "@/lib/nav";

export default function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 inset-x-0 z-20 border-t border-zinc-200 bg-white/95 backdrop-blur flex md:hidden safe-pb">
      {NAV_LINKS.map(({ href, short, label }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className={`flex-1 min-w-0 flex flex-col items-center gap-0.5 py-2 text-[11px] border-t-2 -mt-px ${
              active
                ? "text-zinc-900 border-zinc-900"
                : "text-zinc-500 border-transparent"
            }`}
            aria-current={active ? "page" : undefined}
            aria-label={label}
          >
            <NavIcon href={href} />
            <span className="truncate max-w-full px-1">{short}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function NavIcon({ href }: { href: NavHref }) {
  switch (href) {
    case "/transactions":
      return <ListIcon />;
    case "/categories":
      return <TagIcon />;
    case "/expenditures":
      return <CoinIcon />;
    case "/plan":
      return <CalendarIcon />;
    case "/charts":
      return <LineChartIcon />;
  }
}

const svgProps = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function ListIcon() {
  return (
    <svg {...svgProps}>
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg {...svgProps}>
      <path d="M20.59 13.41L13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  );
}

function CoinIcon() {
  return (
    <svg {...svgProps}>
      <circle cx="12" cy="12" r="9" />
      <path d="M15 9a3 3 0 0 0-3-2c-1.66 0-3 1-3 2.5S10.34 12 12 12s3 1 3 2.5S13.66 17 12 17a3 3 0 0 1-3-2" />
      <line x1="12" y1="6" x2="12" y2="7" />
      <line x1="12" y1="17" x2="12" y2="18" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg {...svgProps}>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function LineChartIcon() {
  return (
    <svg {...svgProps}>
      <polyline points="3 17 9 11 13 15 21 7" />
      <polyline points="14 7 21 7 21 14" />
    </svg>
  );
}
