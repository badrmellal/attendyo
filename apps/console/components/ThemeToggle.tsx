"use client";

/**
 * ThemeToggle — quiet dark/light switch. Dark is the default for this product.
 */

import { Moon, Sun } from "lucide-react";
import { useBranding } from "./BrandingProvider";
import { cn } from "@/lib/utils";

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggleTheme } = useBranding();
  const isDark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Light theme" : "Dark theme"}
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface-2/50 text-text-muted transition-colors duration-150 hover:text-text hover:border-text-muted/40",
        className,
      )}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
