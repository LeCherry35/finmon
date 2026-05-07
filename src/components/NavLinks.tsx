"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/transactions", label: "Transactions" },
  { href: "/categories", label: "Categories" },
  { href: "/expenditures", label: "Expenditures" },
  { href: "/plan", label: "Plan" },
];

export default function NavLinks() {
  const pathname = usePathname();

  return (
    <>
      {links.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          className={
            pathname === href
              ? "text-zinc-900 font-medium"
              : "text-zinc-500 hover:text-zinc-900"
          }
        >
          {label}
        </Link>
      ))}
    </>
  );
}
