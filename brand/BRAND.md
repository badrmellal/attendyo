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
2. **The Check Gate mark** is the through-line — a minimal doorway with a checkmark at
   its heart, echoed in the logo, the kiosk viewport the face appears inside, section
   markers, and empty states.
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

## The Check Gate (logo + motif)

A minimal rounded doorway with a confident checkmark resolving at its center — you pass
through, you're confirmed. Deliberately NOT a literal regional-architecture illustration
(that was the old Attendyo mark, built as a pun on that name); this is a universal, modern
mark that reads instantly at 16px and scales to a hero without looking twee.

Inline SVG so it recolors from tokens. Use this exact path as `BrandLogo`'s glyph and the
favicon in **both** apps (Console + Gate) so the mark is pixel-identical everywhere:
```svg
<svg viewBox="0 0 24 28" fill="none" xmlns="http://www.w3.org/2000/svg">
  <!-- The gate: a soft rounded doorway, not a horseshoe arch -->
  <path d="M4 26 V11 C4 6.6 7.6 3 12 3 C16.4 3 20 6.6 20 11 V26"
        stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <!-- The check: resolving inside it -->
  <path d="M8.3 15.6 L11 18.4 L16.2 12.4"
        stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
```
`BrandLogo` = this glyph (colored `text-primary`) + the wordmark in **Fraunces**
(`font-display`), reading `branding.product_name` (default "Attendyo"), tracked
`tracking-tight`. The checkmark stroke may use `text-accent` instead of inheriting
`currentColor` for a two-tone treatment if it reads cleanly at small sizes — designer's
call, but keep both apps consistent with each other.

### Gate kiosk signature
The live camera sits **inside the gate outline** (mask the video with the doorway
silhouette from the path above, scaled to fill the viewport — drop the checkmark at this
scale, it's a small-glyph-only detail). Idle: the gate outline traced in **gold**.
Scanning: a soft gold sweep along the outline. **Granted:** the gate + name glow
**ultramarine**, the door-open pulse expands from the top-center (where the checkmark
would sit), "Bienvenue {name}". **Denied:** the gate flushes **rose** once, calmly. This
signature moment carries over unchanged in spirit from the previous mark — only the
outline geometry changes (gentle doorway curve, not a horseshoe arch).

## Surfaces
- **Console** (`apps/console`, :3000): admin dashboard — login, today overview, people +
  one-photo enrolment, daily attendance (in/out per day) + CSV export, live monitor,
  doors/cameras, settings/branding.
- **Gate** (`apps/gate`, :3001): fullscreen door terminal — live webcam inside the Check
  Gate frame, greets by name, animates door-open, shows check-in/out. Built for a wall
  tablet by the door.

Both read branding tokens from the API and never hard-code "Attendyo" in a way that
blocks white-labeling.
