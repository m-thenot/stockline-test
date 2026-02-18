import { useEffect, useState } from "react";

const STORAGE_KEY = "sidebar-collapsed";

/**
 * Hook for managing sidebar collapse state with localStorage persistence
 */
export function useSidebarCollapse() {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;

    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : false;
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(isCollapsed));
  }, [isCollapsed]);

  const toggle = () => {
    setIsCollapsed((prev) => !prev);
  };

  return {
    isCollapsed,
    toggle,
  };
}
