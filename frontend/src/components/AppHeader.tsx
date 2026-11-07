import type { ReactNode } from "react";

import { CARD_SHADOW, cn } from "@/lib/utils";

import { HREF } from "../route";

import { Icon } from "./Icon";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";

const NAV_ITEMS = [
  { label: "Müşteri Desteği", href: HREF.support },
  { label: "Yönetici Değerlendirme & Test Paneli", href: HREF.admin },
] as const;

type NavItem = (typeof NAV_ITEMS)[number]["label"];

interface Props {
  /** The page being shown; none on the login screen. */
  active?: NavItem;
  /** Page-specific controls at the far right, after the theme toggle. */
  children?: ReactNode;
}

/** One header for every page, so the logo, menu and controls never move between pages. */
export function AppHeader({ active, children }: Props) {
  return (
    <header
      className={cn(
        "fixed top-0 left-0 right-0 z-40 bg-surface-container-lowest/90 backdrop-blur-xl",
        CARD_SHADOW,
      )}
    >
      <div className="h-16 w-full px-gutter-sm lg:px-margin flex items-center justify-between gap-space-md">
        <div className="flex items-center gap-space-lg">
          <Logo />
          <nav className="hidden xl:flex items-center gap-space-xs">
            {NAV_ITEMS.map(({ label, href }) => (
              <a
                key={label}
                href={href}
                aria-current={label === active ? "page" : undefined}
                className={cn(
                  "px-space-md py-space-xs rounded-lg font-label-md text-label-md transition-all",
                  label === active
                    ? "bg-pattern-panel relative bg-surface-container-lowest text-primary font-semibold ring-1 ring-primary/30 shadow-sm"
                    : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface",
                )}
              >
                {/* Positioned so the label paints above the pattern's ::before layer. */}
                <span className="relative">{label}</span>
              </a>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-space-md">
          <div className="hidden md:flex items-center gap-space-xs px-space-sm py-1 rounded-lg bg-surface-container-low border border-outline-variant/40">
            <Icon name="storefront" className="text-on-surface-variant text-[18px]" />
            <span className="font-label-sm text-label-sm text-on-surface font-semibold">
              ModaTrend Mağazası #4182
            </span>
          </div>
          <ThemeToggle />
          {children}
        </div>
      </div>
    </header>
  );
}
