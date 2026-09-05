"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useTranslations } from "next-intl";
import {
  GitBranch,
  LayoutGrid,
  MessageSquare,
  Sun,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTotalUnread } from "@/hooks/use-total-unread";

const tabs = [
  { href: "/inbox", labelKey: "inbox", icon: MessageSquare },
  { href: "/contacts", labelKey: "contacts", icon: Users },
  { href: "/pipelines", labelKey: "pipelines", icon: GitBranch },
  { href: "/solar", labelKey: "solar", icon: Sun },
] as const;

interface MobileTabBarProps {
  onMore: () => void;
}

function MobileTabBarInner({ onMore }: MobileTabBarProps) {
  const t = useTranslations("MobileTabBar");
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const totalUnread = useTotalUnread();

  const inInboxThread = pathname.startsWith("/inbox") && !!searchParams.get("c");
  if (inInboxThread) return null;

  const primaryActive = tabs.some(
    (tab) => pathname === tab.href || pathname.startsWith(`${tab.href}/`),
  );

  return (
    <nav
      aria-label={t("label")}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 backdrop-blur-md lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="grid h-14 grid-cols-5">
        {tabs.map((tab) => {
          const isActive =
            pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                className={cn(
                  "flex h-full flex-col items-center justify-center gap-0.5 text-[10px] font-medium",
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground active:text-foreground",
                )}
              >
                <span className="relative">
                  <tab.icon className="h-5 w-5" />
                  {tab.href === "/inbox" && totalUnread > 0 && (
                    <span className="absolute -right-1.5 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[8px] font-bold text-primary-foreground">
                      {totalUnread > 9 ? "9+" : totalUnread}
                    </span>
                  )}
                </span>
                {t(tab.labelKey)}
              </Link>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            onClick={onMore}
            className={cn(
              "flex h-full w-full flex-col items-center justify-center gap-0.5 text-[10px] font-medium",
              !primaryActive
                ? "text-primary"
                : "text-muted-foreground active:text-foreground",
            )}
          >
            <LayoutGrid className="h-5 w-5" />
            {t("more")}
          </button>
        </li>
      </ul>
    </nav>
  );
}

export function MobileTabBar({ onMore }: MobileTabBarProps) {
  return (
    <Suspense fallback={null}>
      <MobileTabBarInner onMore={onMore} />
    </Suspense>
  );
}
