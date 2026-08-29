"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import {
  Boxes,
  Compass,
  LayoutDashboard,
  LineChart,
  type LucideIcon,
  PlayCircle,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/development", label: "Development", icon: Compass },
  { href: "/assets", label: "Assets", icon: Boxes },
  { href: "/forecast", label: "Forecast", icon: LineChart },
  { href: "/validation", label: "Validation", icon: ShieldCheck },
  { href: "/optimization", label: "Optimization", icon: SlidersHorizontal },
  { href: "/copilot", label: "Copilot", icon: Sparkles },
  { href: "/demo", label: "Demo Story", icon: PlayCircle },
];

function BrandMark() {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-brand to-accent-cyan text-sm font-bold text-white shadow-sm">
        W
      </span>
      <div>
        <p className="text-sm font-bold leading-tight text-foreground">WeaveGrid AI</p>
        <p className="text-[11px] font-medium leading-tight text-muted">Virtual Power Plant</p>
      </div>
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-border bg-surface px-4 py-6">
      <div className="mb-8">
        <BrandMark />
      </div>

      <nav className="flex flex-1 flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname?.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-brand/8 text-brand ring-1 ring-brand/15"
                  : "text-muted hover:bg-surface-raised hover:text-foreground"
              )}
            >
              <Icon className={clsx("h-[18px] w-[18px]", active ? "text-brand" : "text-slate-400")} strokeWidth={2} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="rounded-lg border border-border bg-surface-raised p-3 text-[11px] leading-relaxed text-muted">
        Simulated demo data. AI Copilot answers are grounded in the live dashboard state.
      </div>
    </aside>
  );
}

/** Compact horizontal nav for small screens, where the sidebar is hidden. */
export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav className="scrollbar-thin sticky top-0 z-20 flex gap-1 overflow-x-auto border-b border-border bg-surface/95 px-3 py-2 backdrop-blur md:hidden">
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.href || pathname?.startsWith(item.href + "/");
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={clsx(
              "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              active
                ? "border-brand/30 bg-brand/8 text-brand"
                : "border-border text-muted hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4" strokeWidth={2} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
