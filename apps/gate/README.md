# Liwan Gate

Fullscreen face-recognition **door kiosk** for wall tablets. Mounted next to a
door, it watches for a known face, greets the person by name, animates the
door-open moment, and records the check-in / check-out. Built for an unattended
terminal that runs all day on the local network — no cloud, no telemetry, no
subscription.

One of two front-ends over the Liwan API (see `CONTRACT.md`):

- **Console** (`apps/console`, :3000) — admin dashboard.
- **Gate** (`apps/gate`, :3001) — this app, the door terminal.

## How it works

1. Reads branding (product name, emerald `--primary`, accent, locale, logo)
   from `GET /api/settings → branding` and recolors itself at runtime — it is
   **white-label**, never hard-coding the brand.
2. Opens the front camera with `getUserMedia` into a rounded viewport with a
   thin scanning guide.
3. Every ~1.5s captures a frame and `POST`s it multipart to `/api/recognize`
   with the `X-Device-Key` device header and the resolved `camera_id` / `door_id`.
   Captures are throttled — one call in flight, and nothing fires while a result
   is on screen.
4. On **`granted`** it plays the signature moment: an emerald ring/glow pulse,
   a large localized welcome (`Bienvenue {name}`), the title/department, the
   check-in vs check-out direction and time, then returns to idle after ~3.5s.
5. On **`unknown_face` / `not_authorized` / `off_schedule` / `denied`** it does
   a single calm red shake with a short reason — no alarm theatrics. Validity-window
   denials (reason `expired` / `not_yet_valid`) get their own localized line
   ("Accès expiré — contactez l'accueil"), never the raw machine code.
6. While idle it shows a live clock, date, the brand wordmark, a soft
   "Regardez la caméra" hint, and a quiet privacy footer ("Traitement 100 %
   local — vos données ne quittent pas le site.").

It also subscribes (best-effort) to the `GET /api/events/stream` SSE feed so a
person recognized by a fixed RTSP camera on the same door (via the Bridge) can
still trigger the door-open moment on the tablet.

## Configuration

Copy `.env.example` to `.env.local`. All vars are build-time inlined
(`NEXT_PUBLIC_*`).

| Variable                  | Purpose                                                        |
| ------------------------- | -------------------------------------------------------------- |
| `NEXT_PUBLIC_API_URL`     | Liwan API base (default `http://localhost:8088`).              |
| `NEXT_PUBLIC_DEVICE_KEY`  | Shared secret sent as `X-Device-Key`. Must match the API.      |
| `NEXT_PUBLIC_CAMERA_ID`   | This terminal's camera (`liwan.cameras.id`).                   |
| `NEXT_PUBLIC_DOOR_ID`     | This terminal's door (`liwan.doors.id`).                       |
| `NEXT_PUBLIC_MOCK`        | `1` to simulate recognitions on a timer with no camera/engine. |

### Per-tablet overrides

A single built image can serve many doors. Override per device with query
params — they take precedence over env:

```
http://<host>:3001/?camera=<camera-uuid>&door=<door-uuid>
http://<host>:3001/?mock=1
```

### Localization

The UI follows `branding.locale`: `fr` (default), `en`, or `ar` (right-to-left).
All on-screen strings live in `lib/branding.ts`.

## Develop

```bash
npm install
npm run dev          # http://localhost:3001
NEXT_PUBLIC_MOCK=1 npm run dev   # demo with no camera / no API
npm run typecheck
npm run build
```

> The camera requires a secure context. `localhost` is treated as secure;
> on a LAN IP, serve the kiosk over HTTPS (or use a kiosk browser flag) so
> `getUserMedia` is allowed.

## Build & run (Docker)

Built as part of the full stack from the repo root:

```bash
docker compose up -d        # Gate is published on :3001
```

The image is a standalone Next.js server (`output: "standalone"`), runs as an
unprivileged user, and makes no outbound calls beyond the Liwan API on your LAN.

## Kiosk tips

- Launch the tablet browser in fullscreen / kiosk mode pointed at
  `http://<host>:3001/?camera=…&door=…`.
- Disable screen sleep and OS gestures so the terminal stays live.
- The app suppresses text selection, scroll bounce, and pinch-zoom for a clean
  appliance feel.
