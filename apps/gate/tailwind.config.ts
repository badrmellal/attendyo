import type { Config } from "tailwindcss";

/**
 * Tailwind config for Liwan Gate.
 *
 * Colors map to CSS custom properties declared in globals.css so the brand can be
 * recolored at runtime from `GET /api/settings → branding` (primary/accent).
 * Defaults come from brand/BRAND.md (dark-first security product).
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "rgb(var(--bg) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        "surface-2": "rgb(var(--surface-2) / <alpha-value>)",
        border: "rgb(var(--border) / <alpha-value>)",
        text: "rgb(var(--text) / <alpha-value>)",
        "text-muted": "rgb(var(--text-muted) / <alpha-value>)",
        primary: "rgb(var(--primary) / <alpha-value>)",
        "primary-2": "rgb(var(--primary-2) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",
        info: "rgb(var(--info) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Georgia", "serif"],
      },
      borderRadius: {
        xl: "16px",
        "2xl": "24px",
        "3xl": "32px",
      },
      keyframes: {
        // Signature moment: ultramarine ring expands outward on door-open.
        "door-ring": {
          "0%": { transform: "scale(0.92)", opacity: "0.9" },
          "70%": { opacity: "0.25" },
          "100%": { transform: "scale(1.18)", opacity: "0" },
        },
        // A soft gold light tracing along the arch outline while idle/scanning.
        "arch-sweep": {
          "0%": { strokeDashoffset: "100", opacity: "0" },
          "12%": { opacity: "0.9" },
          "88%": { opacity: "0.9" },
          "100%": { strokeDashoffset: "-100", opacity: "0" },
        },
        // Soft glow breathing behind the granted state.
        "glow-pulse": {
          "0%, 100%": { opacity: "0.55" },
          "50%": { opacity: "1" },
        },
        // Calm single shake for denied / unknown — no alarm theatrics.
        "calm-shake": {
          "0%, 100%": { transform: "translateX(0)" },
          "20%": { transform: "translateX(-9px)" },
          "40%": { transform: "translateX(8px)" },
          "60%": { transform: "translateX(-5px)" },
          "80%": { transform: "translateX(3px)" },
        },
        // Content rises in under the greeting.
        "rise-in": {
          "0%": { transform: "translateY(14px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        // The thin scanning guide sweeping the viewport.
        scan: {
          "0%": { transform: "translateY(-6%)", opacity: "0" },
          "12%": { opacity: "1" },
          "88%": { opacity: "1" },
          "100%": { transform: "translateY(106%)", opacity: "0" },
        },
      },
      animation: {
        "door-ring": "door-ring 1400ms ease-out forwards",
        "door-ring-delayed": "door-ring 1400ms ease-out 220ms forwards",
        "arch-sweep": "arch-sweep 3.4s ease-in-out infinite",
        "glow-pulse": "glow-pulse 2.4s ease-in-out infinite",
        "calm-shake": "calm-shake 520ms cubic-bezier(0.36,0.07,0.19,0.97) both",
        "rise-in": "rise-in 360ms ease-out both",
        "fade-in": "fade-in 240ms ease-out both",
        scan: "scan 2.8s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
