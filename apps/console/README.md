# Attendyo Console

Premium, dark-first admin dashboard for the **Attendyo** on-premise face attendance
& access-control system. It consumes the Attendyo API described in
[`../../CONTRACT.md`](../../CONTRACT.md) and is fully **white-label**: product
name, tagline, colors, logo, and locale all come from
`GET /api/settings → branding` — nothing brand-identifying is hard-coded.

Built with Next.js 15 (App Router) + React 19 + Tailwind. Runs entirely on your
LAN. No cloud calls, no telemetry.

## Pages

| Route          | What it does                                                                 |
| -------------- | --------------------------------------------------------------------------- |
| `/login`       | Elegant split sign-in. Calls `POST /api/auth/login`.                         |
| `/dashboard`   | Today: present / late / absent / on-site-now / denied, hourly chart, live feed, latest entries. |
| `/people`      | Searchable / filterable member directory. Enroll dialog with one-photo upload **and** webcam capture. |
| `/attendance`  | Daily in/out record (single day or range), CSV export.                      |
| `/monitor`     | Full-bleed live access wall via SSE (`/api/events/stream`).                  |
| `/doors`       | Doors + cameras, per-door **Test open** button.                             |
| `/settings`    | Branding editor (white-label) + attendance config with live preview.        |

## Mock mode (review without a backend)

The Console ships a rich offline layer (`lib/mock.ts`). It activates when:

- `NEXT_PUBLIC_MOCK=1`, **or**
- the real API at `NEXT_PUBLIC_API_URL` is unreachable (network fallback only —
  real `4xx/5xx` responses are surfaced, not masked).

In mock mode the whole app renders with believable demo data: ~24 members, four
doors, a live event stream, a full day of attendance, and working CSV export.
Sign in with **`admin@attendyo.local`** / **`attendyo-admin`**.

## Develop

```bash
cp .env.example .env.local      # NEXT_PUBLIC_MOCK=1 for offline demo
npm install
npm run dev                     # http://localhost:3000
```

Useful scripts:

```bash
npm run build       # production build (standalone output)
npm run typecheck   # tsc --noEmit
npm run lint        # next lint
```

## Environment

| Var                   | Default                 | Purpose                                                |
| --------------------- | ----------------------- | ------------------------------------------------------ |
| `NEXT_PUBLIC_API_URL` | `http://localhost:8088` | Base URL the browser uses to reach the Attendyo API.      |
| `NEXT_PUBLIC_MOCK`    | _(unset)_               | `1` forces the offline mock layer (demos / reviews).   |

## Architecture

```
app/
  layout.tsx              fonts (Sora + Inter), BrandingProvider, theme
  login/page.tsx          split sign-in
  (app)/
    layout.tsx            AppShell: Sidebar + TopBar + auth guard
    dashboard/ people/ attendance/ monitor/ doors/ settings/
components/                Sidebar, TopBar, StatCard, StatusPill, DataTable,
                           EnrollDialog, LiveFeed, BrandLogo, ThemeToggle, …
lib/
  types.ts                domain types — mirrored from CONTRACT.md
  api.ts                  typed client (bearer auth) + transparent mock fallback
  mock.ts                 rich offline dataset + SSE simulation
  branding.ts             apply branding tokens to CSS vars at runtime
  i18n.ts                 fr / en / ar UI strings
  utils.ts                cn, formatters (time, duration, similarity)
```

### White-label

`BrandingProvider` loads `GET /api/settings` once, writes `--primary` / `--accent`
to the document root as RGB triplets, and sets `lang` / `dir` (RTL for Arabic).
`BrandLogo` recolors its inline SVG from `--primary` and renders the configured
`logo_url` when present. The Settings page edits these tokens with a live preview
and commits them to the running app on save.

## Docker

Multi-stage build producing a standalone server (`output: "standalone"`), run as
an unprivileged user. Wired up in the repo `docker-compose.yml` as `attendyo-console`
on port `3000`.

```bash
docker build --build-arg NEXT_PUBLIC_API_URL=http://localhost:8088 -t attendyo-console .
```
