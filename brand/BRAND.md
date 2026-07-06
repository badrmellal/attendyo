# ATTENDYO — Brand & Design System

> **Attendyo** — from *attend*: the one thing every workplace, campus, bank branch, and
> residence needs to get right, every single day. The product does exactly that: it
> recognises the people who belong, opens the way for them, and remembers every coming
> and going — on your own server, sold once, owned forever.

## Positioning (one line)
On-premise face attendance & access control that lives entirely on your premises —
no cloud, no subscription, no RFID cards to lose. One photo enrolls a person; the door
opens when it knows them; every entry and exit is logged for the day.

## Tagline
**"The face is the key."** (FR: *Le visage est la clé.* · AR: *الوجه هو المفتاح.*)
Short, literal, and does double duty: it's the whole pitch (no badges, no cards, no PINs)
in four words.

## Design intent — *not generic SaaS*
Most access/HR dashboards look the same: Inter, cold slate, an emerald or indigo accent,
lucide icons in a card grid. Attendyo deliberately departs from that:
1. **An architectural serif wordmark** (Fraunces) — editorial, confident, premium. No
   geometric-sans sameness.
2. **The Aperture Tile mark** is the through-line — a gradient tile with a portal opening
   and a gold "recognised" spark, echoed in the kiosk viewport the face appears inside,
   section markers, and empty states.
3. **A "riad at night" palette** — a warm violet-ink field, **ultramarine/Majorelle**
   as the primary, and **sand/ochre gold** as the accent. Distinctive and warm — the
   opposite of the stock emerald-on-slate look, and a quiet nod to the product's home
   market without leaning on a literal cultural motif for the logo itself.
4. Restraint and craft: hairline borders, one signature motion moment (the gate tracing
   open, the check resolving), tabular numerals, generous space.

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

Unchanged from before — paste verbatim into `app/globals.css` if not already present.
`--primary` and `--accent` are overwritten at runtime from `GET /api/settings → branding`,
so the product stays white-label.

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
  --primary-2: 124 92 255; /* #7C5CFF  violet — gradient / accents */
  --accent: 224 163 64;    /* #E0A340  sand / ochre gold — "late" + premium + gate trace */
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
- `.btn-primary` text color must be light on the ultramarine (`#FBFAFF`).
- Ambient `.app-aura` should read ultramarine (top-left) + gold (top-right), e.g.
  `rgb(var(--primary)/0.10)` and `rgb(var(--accent)/0.06)`.
- "Granted / present" → `--primary`. "Late" → `--accent`. "Denied / absent" → `--danger`.

## The Aperture Tile (logo + motif)

An **app-icon-grade rounded tile**: an ultramarine→violet gradient, a portal opening
reversed out in white, and a gold "recognised" spark at its apex — the mark of a finished
product, legible at 16px and premium at hero scale. Deliberately NOT a literal
regional-architecture illustration (that was an earlier mark, built as a pun on a former
name); this is universal and modern.

Inline SVG so it recolors from tokens: the tile gradient reads `--primary` → `--primary-2`,
the spark reads `--accent`, the portal stays white for contrast on any brand colour. Use
this exact geometry as `BrandMark` / `ApertureMark` in **both** apps (Console + Gate) and
the favicon, so the mark is pixel-identical everywhere. Give the gradient a **unique id
per instance** (React `useId`) to avoid `<defs>` collisions when several marks share a page:
```svg
<svg viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="52" y2="52" gradientUnits="userSpaceOnUse">
      <stop stop-color="rgb(var(--primary))"/><stop offset="1" stop-color="rgb(var(--primary-2))"/>
    </linearGradient>
    <linearGradient id="h" x1="26" y1="0" x2="26" y2="30" gradientUnits="userSpaceOnUse">
      <stop stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="52" height="52" rx="14" fill="url(#g)"/>            <!-- gradient tile -->
  <rect width="52" height="52" rx="14" fill="url(#h)"/>            <!-- top highlight for depth -->
  <path d="M16 40 V24 C16 16.8 20.5 12 26 12 C31.5 12 36 16.8 36 24 V40" stroke="#fff" stroke-width="3.1" stroke-linecap="round" opacity=".96"/>
  <path d="M22 40 V26 C22 22 23.8 20 26 20 C28.2 20 30 22 30 26 V40" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".5"/>
  <circle cx="26" cy="22.5" r="2.7" fill="rgb(var(--accent))"/>   <!-- the "recognised" spark -->
</svg>
```
`BrandLogo` = this tile + the wordmark in **Fraunces** (`font-display`), reading
`branding.product_name` (default "Attendyo"), tracked `tracking-tight`. The favicon uses
the same geometry with literal hex (a favicon file has no CSS-var context): tile
`#6470FF`→`#7C5CFF`, portal `#fff`, spark `#E0A340`.

### Gate kiosk signature
The kiosk frames the live camera **inside a doorway silhouette** — its own element,
independent of the app logo tile (the visitor literally appears within a portal). Idle:
the outline traced in **gold**. Scanning: a soft gold sweep along the outline.
**Granted:** the outline + name glow **ultramarine**, the door-open pulse expands from the
top-center, "Bienvenue {name}". **Denied:** it flushes **rose** once, calmly.

## Surfaces
- **Console** (`apps/console`, :3000): admin dashboard — login, today overview, people +
  one-photo enrolment, daily attendance (in/out per day) + CSV export, live monitor,
  doors/cameras, settings/branding.
- **Gate** (`apps/gate`, :3001): fullscreen door terminal — live webcam inside the Check
  Gate frame, greets by name, animates door-open, shows check-in/out. Built for a wall
  tablet by the door.

Both read branding tokens from the API and never hard-code "Attendyo" in a way that
blocks white-labeling.
