# LIWAN — Brand & Design System

> **Liwan** — لِيوان / إيوان. The great vaulted hall fronted by a monumental **arch**,
> the threshold between a Moroccan courtyard and the rooms beyond. The product stands at
> that threshold: it knows your people, opens the way, and remembers every coming and going.
> Sold once, owned forever, runs on your own LAN.

## Positioning (one line)
On-premise face attendance & access control that lives entirely on your premises —
no cloud, no subscription, no RFID cards to lose. One photo enrolls a person; the door
opens when it knows them; every entry and exit is logged for the day.

## Design intent — *not generic SaaS*
Most access/HR dashboards look the same: Inter, cold slate, an emerald or indigo accent,
lucide icons in a card grid. Liwan deliberately departs from that:
1. **An architectural serif wordmark** (Fraunces) — editorial, confident, premium. No
   geometric-sans sameness.
2. **The arch motif** (the *iwan*) is the through-line — the logo, the kiosk viewport
   the face appears inside, section markers, and empty states are all framed by an arch.
3. **A "riad at night" palette** — a warm violet-ink field, **ultramarine/Majorelle**
   as the primary, and **sand/ochre gold** as the accent. Moroccan, warm, distinctive —
   the opposite of the stock emerald-on-slate look.
4. Restraint and craft: hairline borders, one signature motion moment (the arch tracing
   open), tabular numerals, generous space.

## Typography
- **Display / wordmark / headings / big numbers:** **Fraunces** (variable serif, optical
  size, a little personality). CSS var `--font-display`. Use the `font-display` class.
- **UI / body / tables:** **Hanken Grotesk** (clean, warm, legible — not Inter). CSS var
  `--font-sans`. This is the default `body` font.
- **Arabic locale:** **IBM Plex Sans Arabic** (or Cairo) for `ar`.
- Numbers that carry meaning use `.tnum` (tabular-nums).

`layout.tsx` (both apps) loads them via next/font/google:
```tsx
import { Fraunces, Hanken_Grotesk } from "next/font/google";
const display = Fraunces({ subsets: ["latin"], weight: ["400","500","600","700"], style: ["normal","italic"], variable: "--font-display", display: "swap" });
const sans = Hanken_Grotesk({ subsets: ["latin"], weight: ["400","500","600","700"], variable: "--font-sans", display: "swap" });
// <html className={`${display.variable} ${sans.variable}`}>
```
`tailwind.config.ts → theme.extend.fontFamily`:
```ts
sans: ["var(--font-sans)", "system-ui", "sans-serif"],
display: ["var(--font-display)", "Georgia", "serif"],
```

## Color tokens (dark-first; values are "R G B" triplets for Tailwind opacity)

Paste verbatim into `app/globals.css`. `--primary` and `--accent` are overwritten at
runtime from `GET /api/settings → branding`, so the product stays white-label.

```css
:root,
[data-theme="dark"] {
  --bg: 12 10 18;          /* #0C0A12  violet-ink field */
  --surface: 21 18 30;     /* #15121E */
  --surface-2: 30 26 42;   /* #1E1A2A */
  --border: 44 39 64;      /* #2C2740 */
  --text: 236 231 244;     /* #ECE7F4 */
  --text-muted: 154 147 174;/* #9A93AE */
  --primary: 86 99 242;    /* #5663F2  ultramarine / Majorelle — brand + "granted/present" */
  --primary-2: 124 92 255; /* #7C5CFF  violet — gradient / arch sweep */
  --accent: 224 163 64;    /* #E0A340  sand / ochre gold — "late" + premium + arch trace */
  --danger: 242 85 119;    /* #F25577  rose-red — "denied/absent" */
  --info: 139 123 255;     /* #8B7BFF  lilac — neutral secondary */
  --shadow-strength: 0.55;
  color-scheme: dark;
}
[data-theme="light"] {
  --bg: 246 244 251;       /* #F6F4FB */
  --surface: 255 255 255;
  --surface-2: 239 234 248;
  --border: 226 220 239;
  --text: 22 18 31;        /* #16121F */
  --text-muted: 107 100 128;
  --primary: 75 84 224;    /* #4B54E0 deeper ultramarine for light contrast */
  --primary-2: 124 92 255;
  --accent: 181 131 43;    /* #B5832B deeper gold on light */
  --danger: 214 67 95;
  --info: 111 92 240;
  --shadow-strength: 0.12;
  color-scheme: light;
}
```
Notes when applying:
- `.btn-primary` text color must be light on the ultramarine (`#FBFAFF`), not the old
  dark-green-on-emerald value.
- Ambient `.app-aura` should read ultramarine (top-left) + gold (top-right), e.g.
  `rgb(var(--primary)/0.10)` and `rgb(var(--accent)/0.06)`.
- "Granted / present" → `--primary`. "Late" → `--accent`. "Denied / absent" → `--danger`.

## The arch (logo + motif)
Inline SVG so it recolors from tokens. Horseshoe/round Moroccan arch with a recognised
"face" dot inside. Use this as `BrandLogo`'s glyph and the favicon:
```svg
<svg viewBox="0 0 24 28" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M4 27 V12.5 C4 6.7 7.6 3 12 3 C16.4 3 20 6.7 20 12.5 V27"
        stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <path d="M8 27 V13 C8 9.5 9.8 7.4 12 7.4 C14.2 7.4 16 9.5 16 13 V27"
        stroke="currentColor" stroke-width="1.4" opacity="0.45"/>
  <circle cx="12" cy="12.2" r="2.1" fill="currentColor"/>
</svg>
```
`BrandLogo` = this glyph (colored `text-primary`, or a primary→primary-2 gradient) +
the wordmark in **Fraunces** (`font-display`), reading `branding.product_name` (default
"Liwan"), tracked `tracking-tight`.

### Gate kiosk signature
The live camera sits **inside an arch** (mask the video with the arch silhouette, or
overlay a thick arch frame). Idle: the arch outline traced in **gold**. Scanning: a soft
gold sweep along the arch. **Granted:** the arch + name glow **ultramarine**, the door-open
pulse expands from the keystone, "Bienvenue {name}". **Denied:** the arch flushes **rose**
once, calmly. This arched-threshold moment is the product's memorable image.

## Surfaces
- **Console** (`apps/console`, :3000): admin dashboard — login, today overview, people +
  one-photo enrolment, daily attendance (in/out per day) + CSV export, live monitor,
  doors/cameras, settings/branding.
- **Gate** (`apps/gate`, :3001): fullscreen door terminal — arched live webcam, greets by
  name, animates door-open, shows check-in/out. Built for a wall tablet by the door.

Both read branding tokens from the API and never hard-code "Liwan" in a way that blocks
white-labeling.
