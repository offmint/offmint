"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Logo } from "@/components/Brand";

/**
 * Shared header for the site and the app: logo left, the links as one centred pill group, an action on the right.
 * The active link (app routes) is a filled pill. On phones the pill group scrolls sideways instead of wrapping.
 */
export function PillNav({ links, right }: { links: readonly (readonly [string, string])[]; right: ReactNode }) {
  const path = usePathname();
  const active = (href: string) => !href.startsWith("#") && !!path?.startsWith(href.split("/").slice(0, 2).join("/"));
  return (
    <header className="sticky top-0 z-30 border-b border-paper-line bg-paper-card/90 backdrop-blur">
      <div className="gutter grid grid-cols-[auto_1fr_auto] items-center gap-3 py-3">
        <span className="shrink-0"><Logo height={24} /></span>
        <nav aria-label="Main" className="flex min-w-0 justify-center">
          <div className="flex min-w-0 gap-1 overflow-x-auto whitespace-nowrap rounded-full border border-paper-line bg-mist p-1 text-sm">
            {links.map(([href, label]) => (
              <Link
                key={href}
                href={href}
                aria-current={active(href) ? "page" : undefined}
                className={`rounded-full px-3 py-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-tide ${active(href) ? "bg-matte text-paper-text" : "text-ink-soft hover:text-ink"}`}
              >
                {label}
              </Link>
            ))}
          </div>
        </nav>
        <span className="shrink-0">{right}</span>
      </div>
    </header>
  );
}
