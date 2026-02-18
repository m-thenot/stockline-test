"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Package,
  Users,
  ClipboardList,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { useSyncStatus } from "@/hooks/use-sync-status";
import { useSidebarCollapse } from "@/hooks/use-sidebar-collapse";
import { getLastSyncLabel } from "@/lib/utils/time";

const navItems = [
  { href: "/products", label: "Products", icon: Package },
  { href: "/partners", label: "Partners", icon: Users },
  { href: "/recap", label: "Recap", icon: ClipboardList },
];

export function Sidebar() {
  const pathname = usePathname();
  const { connection, lastSyncTimestamp } = useSyncStatus();
  const { isCollapsed, toggle } = useSidebarCollapse();

  const connectionLabel =
    connection === "online"
      ? "Online"
      : connection === "offline"
        ? "Offline"
        : "Unknown";

  const syncLabel = getLastSyncLabel(lastSyncTimestamp, connection);

  return (
    <aside
      className={cn(
        "flex h-screen flex-col bg-white shadow-sm transition-all duration-300 ease-in-out",
        isCollapsed ? "w-[70px]" : "w-[240px]",
      )}
    >
      <div
        className={cn(
          "h-20 flex items-center justify-between",
          isCollapsed ? "px-4 flex-col gap-2 pt-4 " : "px-8",
        )}
      >
        {isCollapsed ? (
          <>
            <div className="flex flex-col items-center gap-2 flex-1">
              <div className="flex flex-col items-center gap-1">
                <span
                  className={cn(
                    "h-2.5 w-2.5 rounded-full ring-2 ring-white",
                    connection === "online" && "bg-emerald-500",
                    connection === "offline" && "bg-red-500",
                    connection === "unknown" && "bg-gray-400",
                  )}
                  title={
                    syncLabel
                      ? `${connectionLabel} - Synced ${syncLabel}`
                      : connectionLabel
                  }
                />
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggle}
              className="h-12 w-12"
              aria-label="Expand sidebar"
            >
              <ChevronsRight className="h-6 w-6" />
            </Button>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-semibold tracking-tight">
                  Stockline
                </h1>
                <span
                  className={cn(
                    "h-2.5 w-2.5 rounded-full ring-2 ring-white",
                    connection === "online" && "bg-emerald-500",
                    connection === "offline" && "bg-red-500",
                    connection === "unknown" && "bg-gray-400",
                  )}
                  title={connectionLabel}
                />
              </div>
              {syncLabel && (
                <span className="text-xs text-muted-foreground">
                  Synced {syncLabel}
                </span>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggle}
              className="h-12 w-12"
              aria-label="Collapse sidebar"
            >
              <ChevronsLeft className="h-6 w-6" />
            </Button>
          </>
        )}
      </div>
      <Separator className="opacity-50" />

      {/* Navigation */}
      <nav
        className={cn(
          "flex flex-1 flex-col gap-2",
          isCollapsed ? "p-2" : "p-6",
        )}
      >
        {navItems.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center rounded-xl text-sm font-medium transition-all duration-200",
                isCollapsed
                  ? "justify-center px-2 py-3.5"
                  : "gap-4 px-4 py-3.5",
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
              title={isCollapsed ? item.label : undefined}
              aria-label={item.label}
            >
              <item.icon className="h-5 w-5 flex-shrink-0" />
              {!isCollapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
