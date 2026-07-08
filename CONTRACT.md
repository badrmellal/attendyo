# ATTENDYO — System Contract (source of truth)

Every module builds against this. The backend implements it; the Console and Gate
consume it; the Bridge calls the recognition endpoint. Do not diverge silently — if
a module needs a change, update this file first.

## Topology

```
 Camera (RTSP/USB) ─► Bridge (Python) ─┐
                                       ├─► POST /api/recognize ─► Attendyo API (FastAPI)
 Gate kiosk (browser webcam) ──────────┘                              │
                                                                      ├─► Vision engine  (recognize / enroll)
                                                                      ├─► Postgres (schema `attendyo`)
                                                                      └─► Door driver (webhook | pi_gpio | simulation)

 Console (Next.js) ◄──REST + SSE──► Attendyo API
 Gate    (Next.js) ◄──REST + SSE──► Attendyo API
```

## Base URL & auth

- API base: `http://localhost:8088` (compose service `attendyo-api`).
- Auth: `POST /api/auth/login` → `{ "access_token": "...", "token_type": "bearer" }`.
  Send `Authorization: Bearer <token>` on every `/api/*` call except `/health`,
  `/api/auth/login`, and `/api/recognize` (device calls use `X-Device-Key`).
- Default seeded operator: `admin@attendyo.local` / `attendyo-admin` (change on first run).

## Core types

```ts
type Member = {
  id: string; external_id?: string; full_name: string; subject_name?: string;
  member_type: "employee"|"resident"|"contractor"|"visitor"|"student"|"faculty"|"staff";
  department?: string; title?: string; email?: string; phone?: string;
  access_group_id?: string; photo_url?: string;
  valid_from?: string;   // ISO date; temporary-access window start (visitors/contractors/exchange)
  valid_until?: string;  // ISO date; outside the window → not_authorized, reason "expired"
  kiosk_message?: string; // one-shot door-side note; delivered+cleared on next granted entry
  status: "active"|"suspended"|"archived"; created_at: string;
};

type AccessEvent = {
  id: number; ts: string; member_id?: string; member_name?: string;
  subject_name?: string; similarity?: number; door_id?: string; door_name?: string;
  direction: "in"|"out"|"unknown";
  decision: "granted"|"denied"|"unknown_face"|"not_authorized"|"off_schedule";
  reason?: string; snapshot_url?: string;
};

type AttendanceDay = {
  member_id: string; member_name: string; department?: string; work_date: string;
  first_in_ts?: string; last_out_ts?: string; worked_seconds?: number;
  is_late: boolean; status: "present"|"late"|"absent"|"incomplete";
};

type RecognizeResult = {
  decision: AccessEvent["decision"] | "no_face";
  member?: { id: string; full_name: string; department?: string; title?: string };
  similarity?: number; door_opened: boolean;
  greeting?: string;     // localized, direction- and time-aware (see Smart Gate rules)
  direction: "in"|"out"|"unknown";
  reason?: string;       // machine reason for denials: "expired" | "not_yet_valid" | …
  day_summary?: string;  // on exits: localized "8 h 12 sur site aujourd'hui"
  message?: string;      // one-shot door-side note left by an operator (see rules)
};
```

## Endpoints

### Auth
- `POST /api/auth/login` `{email, password}` → token
- `GET  /api/auth/me` → current user

### Recognition (device / kiosk — the hot path)
- `POST /api/recognize` (multipart: `image`, `camera_id?`, `door_id?`) → `RecognizeResult`
  - Calls the engine's `recognize`, picks best subject, checks threshold + access group +
    schedule, writes an `access_event`, updates `attendance_days`, fires the door driver
    when granted. **One enrolled image is enough** to be recognised here.

### Smart Gate rules (v2.1)

**No face ≠ unknown face.** When the engine finds *no face at all* in the frame
(empty hallway, blur, someone walking past), the API returns
`{ decision: "no_face", door_opened: false, direction: "unknown" }` and does
**nothing else** — no `access_event`, no alert, no attendance, no door action, no
SSE. Kiosks stay idle on `no_face`. Only an actual face that fails a rule
produces negative feedback. (`no_face` exists on the wire only; it is never
stored — the events table enum is unchanged.)

**Direction inference.** Effective direction for a granted event:
1. Door `direction` is `"in"` or `"out"` → use it.
2. Door is `"both"` / no door → infer from presence: member currently **on-site**
   (today's row has `first_in_ts`, not rolled out after it) → `"out"`, else `"in"`.
The attendance roll-up consumes the INFERRED direction (an inferred `"out"` sets
`last_out_ts`).

**Greetings** (localized fr/en/ar; `{name}` = first name):
- `in`: time-aware — before 12:00 site-local `"Bonjour {name}"`, 18:00+
  `"Bonsoir {name}"`, otherwise `"Bienvenue {name}"`.
- `out`: `"Au revoir {name}"` (en `"Goodbye {name}"`, ar `"مع السلامة {name}"`),
  kiosk shows the *Sortie* chip, and `day_summary` is set: total on-site time for
  today, localized (fr `"8 h 12 sur site aujourd'hui"`).

**Door-side messages (one-shot).** `Member.kiosk_message?: string` — an operator
writes a short note on a member (Console → member row → "Message d'accueil";
plain `PATCH /api/members/{id}`). On that member's next **granted** recognition
the API returns it as `message`, then clears it atomically (delivered once).
The kiosk shows it as a distinct gold card under the greeting ("Réunion déplacée
à 14 h — salle B"). The door becomes a targeted, zero-app notification channel.

**Voice.** The Gate kiosk *speaks* the greeting (and reads the message aloud when
present) via the browser's offline `speechSynthesis`, voice matched to
`branding.locale`. No cloud TTS, no audio assets. Disable with `?voice=0` or
`NEXT_PUBLIC_VOICE=0`. Also a soft WebAudio chime: two-note ding on granted, one
low tone on denied, silence on `no_face`; `?sound=0` disables. Neither may ever
throw (autoplay policies → fail silent).

**Soft anti-passback.** A granted event at an explicitly-`"in"` door for a member
already on-site still opens the door but INSERTs an `alerts` row
(`kind: "anti_passback"`, severity `info`, message names member + door).

**Alert cooldown.** At most one alert per (door, kind) per
`settings.security.alert_cooldown_seconds` (default `45`) — a stranger standing
at the door produces one alert, not one per frame. Events are still logged.

### Insights — "{product} IQ" (operator+)
Local behavioural intelligence computed from the attendance history — pure SQL/
stats on the box, no cloud, no ML dependencies. This is the "smart" layer nobody
with a badge terminal can offer.

- `GET /api/insights?limit=` → `{ insights: Insight[] }`
```ts
type Insight = {
  kind: "unusual_arrival"     // today ≥60min later than their 30-day median (and beyond grace)
      | "absence_streak"      // ≥3 consecutive workdays absent
      | "punctuality_streak"  // ≥10 consecutive on-time days (celebrate it)
      | "record_presence";    // today's on-site peak is a 30-day high (site-level)
  member_id?: string; member_name?: string; department?: string;
  text: string;               // ready-to-display FR line, built server-side like alert messages
  date: string;               // ISO date the insight refers to
};
```
- Deterministic and idempotent (same data → same insights; nothing stored).
- Console shows an "IQ" panel on the dashboard (product-name-branded, e.g.
  "Attendyo IQ", from `branding.product_name`); mock layer generates plausible ones.

### Enrollment (one photo is enough)
- `POST /api/members` (multipart: member fields + single `image`) → `Member`
  - Creates the engine subject and adds the one face in a single call.
- `POST /api/members/{id}/photo` (multipart `image`) → add/replace face (optional, improves robustness)
- `GET  /api/members` `?q=&status=&department=&type=` → `Member[]`
- `GET  /api/members/{id}` → `Member`
- `PATCH /api/members/{id}` → `Member`
- `DELETE /api/members/{id}` → removes member + engine subject

### Attendance (the morning-in / evening-out record, per day)
- `GET /api/attendance?date=YYYY-MM-DD` → `AttendanceDay[]` (all members; absent included)
- `GET /api/attendance?from=…&to=…&member_id=…` → range
- `GET /api/attendance/export.csv?date=… (or from/to)` → text/csv
- `GET /api/attendance/{member_id}?from=…&to=…` → that person's history

### Events / live feed
- `GET /api/events?date=&decision=&door_id=&limit=` → `AccessEvent[]`
- `GET /api/events/stream` → **SSE**, emits `event: access` with `AccessEvent` JSON
  on every new decision. Console live monitor and Gate both subscribe.

### Dashboard
- `GET /api/stats/today` → `{ present, late, absent, on_site_now, denied_today,
   total_members, last_in?: AccessEvent, hourly: {hour:int, count:int}[] }`

### Doors & cameras
- `GET/POST /api/doors`, `PATCH/DELETE /api/doors/{id}`
- `POST /api/doors/{id}/open` → manually pulse the door (test button)
- `GET/POST /api/cameras`, `PATCH/DELETE /api/cameras/{id}`

### Access groups
- `GET/POST /api/access-groups`, `PATCH/DELETE /api/access-groups/{id}`
  - `AccessGroup = { id, name, door_ids: string[], schedule: object, created_at }`.
    `door_ids` empty ⇒ all doors; `schedule` `{}` ⇒ any time. Members reference a
    group via `Member.access_group_id`; the recognition rules enforce door
    membership + schedule.

### Settings / branding (white-label)
- `GET /api/settings` → `{ branding:{…}, attendance:{…}, security:{…} }`
- `PUT /api/settings` → update (admin only)
- `settings.security = { alert_cooldown_seconds: number }` (default 45; see Smart Gate rules)
- `branding.terminology: "workforce" | "campus" | "residence"` — relabels the UI:
  - workforce: Personnes/Employés · Département · "Présence"
  - campus:    Étudiants & Personnel · Faculté / École · types student/faculty/staff surfaced first
  - residence: Résidents · Immeuble / Bâtiment · types resident/visitor first
  Labels live in the Console/Gate i18n layer keyed by preset; the API stores the preset only.

## v2 endpoints

### Reports & analytics (operator+)
- `GET /api/reports/summary?from&to` → `{ days:int, avg_present:number, avg_late:number,
   avg_absent:number, punctuality_rate:number, avg_worked_seconds:number,
   daily: { date:string, present:int, late:int, absent:int }[] }`
- `GET /api/reports/departments?from&to` → `{ department:string, members:int, present_days:int,
   late_days:int, absent_days:int, avg_worked_seconds:number }[]`
- `GET /api/reports/members?from&to&sort=late|hours|absences&limit` → `{ member_id, member_name,
   department, present_days, late_days, absent_days, avg_arrival:string|null,
   total_worked_seconds:number }[]`
- `GET /api/reports/export.csv?from&to` → per-member aggregate CSV (accepts `?token=`)

### Presence / muster (operator+)
- `GET /api/presence/now` → `{ count:int, people: { member_id, member_name, department,
   member_type, first_in_ts, first_in_door_name }[] }`
  — members whose today row has `first_in_ts` set and no later `last_out_ts`.
  Console renders this as the live on-site list + a print-ready evacuation (muster) view.

### Alerts (operator+ to ack; created automatically)
- Recognition path: every non-granted decision (except `no_face`) INSERTs an `alerts`
  row (kind = the decision, message localized-neutral, links event/door/member), subject
  to the per-(door,kind) cooldown, and publishes SSE `event: alert` with the Alert JSON.
  Granted double-entries add `kind:"anti_passback"` (see Smart Gate rules).
- `GET /api/alerts?acknowledged=&kind=&limit=` → `Alert[]`
- `GET /api/alerts/count` → `{ unacknowledged:int }` (badge)
- `POST /api/alerts/{id}/ack` → `Alert` (sets acknowledged_by/at from the JWT)
- `POST /api/alerts/ack-all` → `{ acknowledged:int }`
```ts
type Alert = { id:number; ts:string;
  kind:"unknown_face"|"not_authorized"|"off_schedule"|"anti_passback"|"system";
  severity:"info"|"warning"|"critical"; message:string; event_id?:number; door_id?:string;
  door_name?:string; member_id?:string; member_name?:string; acknowledged:boolean;
  acknowledged_by_email?:string; acknowledged_at?:string };
```

### Audit log (admin only; append-only)
- The API records: `login`, `member.create|update|delete|import`, `door.create|update|delete|open`,
  `camera.create|update|delete`, `access_group.create|update|delete`, `settings.update`,
  `user.create|update|delete`, `alerts.ack`. Actor comes from the JWT.
- `GET /api/audit?limit=&action=&user=` → `{ id, ts, user_email, action, entity, entity_id,
   details }[]`

### Team / operator users (admin only)
- `GET /api/users` → `{ id, email, full_name, role, created_at }[]` (no hashes)
- `POST /api/users` `{ email, full_name?, role, password }` → user
- `PATCH /api/users/{id}` `{ full_name?, role?, password? }` → user
- `DELETE /api/users/{id}` → 204. Refuse deleting yourself and the last admin (409).

### Bulk import (operator+)
- `POST /api/members/import` (multipart `file`: CSV with header
  `full_name,external_id,member_type,department,title,email,phone,valid_from,valid_until`)
  → `{ created:int, skipped:int, errors: { line:int, message:string }[] }`
  Creates members WITHOUT photos (enrol face later); skips rows whose
  `external_id` already exists.

### Decision rules v2 (adds to the v1 ladder)
3b. Member has a validity window and today is outside `[valid_from, valid_until]`
    → `not_authorized`, reason `"expired"` (or `"not_yet_valid"`).

### Engine naming (white-label)
The recognition core is referred to as the **Attendyo Vision Engine** in every
customer-facing surface (docs, sales, UI, compose service names, env vars).
Env vars: `ENGINE_URL` / `ENGINE_API_KEY` (the API also accepts the legacy
legacy engine variable names as fallbacks). Third-party attribution
lives ONLY in `NOTICE` / the licence section, as Apache-2.0 requires.

### Health
- `GET /health` → `{ status:"ok"|"degraded", engine:"ok"|"down", db:"ok"|"down" }`

## Recognition → decision rules (implemented by the API)

1. The engine returns subjects with similarity. Take the top match.
2. `similarity < camera.recognition_threshold` → `unknown_face`, door stays shut.
3. Match found but member `status != active` → `not_authorized`.
4. Member's access group does not include this door → `not_authorized`.
5. Outside the access group schedule → `off_schedule`.
6. Otherwise → `granted`: fire door driver, write event, update attendance.
7. **Debounce**: ignore the same member at the same door within
   `attendance.min_revisit_seconds` to avoid double counts.

## Attendance roll-up (per member per day)

- Strategy `first_in_last_out` (default): the day's first `granted` event sets
  `first_in_ts`; the last `granted` event sets `last_out_ts`; `worked_seconds`
  = last_out − first_in. `is_late` when `first_in_ts > site.workday_start + grace`.
- Direction-aware doors refine in/out; single-door sites use first/last.

## v3 — Spatial Intelligence

### Zones (buildings / floors / areas)
```ts
type Zone = { id:string; name:string; kind:"building"|"floor"|"area";
  parent_id?:string;         // e.g. a floor inside a building
  capacity?:number;          // optional soft capacity for congestion tinting
  energy_kw?:number;         // optional connected load, for energy savings math
  created_at:string };
```
- `GET/POST /api/zones`, `PATCH/DELETE /api/zones/{id}` (operator+ mutations).
- `Door.zone_id?: string` — doors belong to a zone (nullable). Camera→door→zone is
  the location chain: **every recognition is a location fix at zone granularity.**
- **Current zone** of an on-site member = the zone of the door of their most recent
  granted event today. Site exit (inferred/explicit "out" at a zone-less door or any
  event that rolls them off-site) clears it.
- `GET /api/presence/now` gains `zone_id`/`zone_name` per person and accepts
  `?zone_id=` (descendants included: asking a building includes its floors) —
  answers **"Show everyone currently inside Building B."**
- `GET /api/zones/occupancy` → `[{ zone_id, name, kind, parent_id, count,
   capacity?, congestion:int /* granted entries, last 15 min */ }]`.

### Movement (door-crossing tracking)
Every camera is a tracker at its door; movement = the sequence of door crossings.
- `GET /api/members/{id}/timeline?date=` → `{ member, date, steps: [{ ts,
   door_name, zone_name?, direction, decision }] }` (granted only by default,
   `&all=1` includes denials). Console: member row → "Parcours" opens a timeline
   drawer; the map page can deep-link it.
Honest scope: this is **zone-level tracking from door crossings** — not continuous
camera-to-camera re-identification (roadmap).

### Live Map — the zone-level digital twin
Console page `/map`: an **isometric SVG** rendering of the zone tree (buildings as
plinths, floors/areas as stacked blocks — auto-layout, no floor-plan upload in v1).
- Live **dots** = people, one per on-site member, grouped in their current zone
  (SSE-driven; dots drift gently, never imply sub-room precision).
- Zone tint by **occupancy** vs capacity; **congestion** badge when entries in the
  last 15 min exceed `max(5, capacity/4)`; hover → count + names (first 6).
- **Emergency mode** button → switches to evacuation view: total on-site, per-zone
  counts, link to the printable muster list (`/presence`).
- Data: `GET /api/zones/occupancy` + `GET /api/presence/now` + SSE `access` events.

### Ask — natural questions, answered locally
`POST /api/ask { q: string }` → `{ intent: string; title: string;
  columns?: string[]; rows?: (string|number)[][]; text?: string;
  suggestions?: string[] }`
A **deterministic intent parser** (FR + EN patterns; no LLM, no cloud — this is the
on-prem answer to "AI questions"). Must cover at least:
- `late_count` — "Qui a été en retard plus de 5 fois ce mois-ci ?" / "Who has been
  late more than N times this month?" (N and period parsed; default month-to-date)
- `inside_zone` — "Qui est dans le Bâtiment B ?" / "Show everyone currently inside
  Building B" (zone name fuzzy-matched against zones)
- `overtime_by_department` — "Quels départements ont le plus d'heures sup ?"
  (overtime = worked − site workday length, summed per department, period parsed)
- `on_site_now`, `absent_today`, `earliest_arrivals`, `member_timeline("…")`
- Unknown question → `intent:"unknown"` + `suggestions` of supported phrasings.
Console: an **Ask bar** on the dashboard ("Demandez à {product_name}…") rendering
the table/text answer inline; Enter to ask, examples shown as chips.

### Energy rules (occupancy-driven automation)
```ts
type EnergyRule = { id:string; zone_id:string; name:string;
  empty_minutes:number;              // zone empty this long → switch OFF
  driver:"webhook"|"simulation";     // same driver family as doors
  driver_config:object;              // webhook: {url,method,on_off,on_on}
  enabled:boolean; state:"on"|"off"; last_changed?:string };
```
- `GET/POST /api/energy/rules`, `PATCH/DELETE /api/energy/rules/{id}`.
- Evaluator: API background loop (~60s): zone occupancy 0 for ≥ `empty_minutes` →
  fire OFF once; first granted entry into the zone → fire ON immediately (hooked
  into the recognize path, fire-and-forget). State transitions logged to
  `energy_log (rule_id, went_off_at, back_on_at)`.
- `GET /api/energy/summary?period=` → `{ rules:int, off_now:int, hours_off:number,
   kwh_saved:number /* Σ zone.energy_kw × hours off */ }` + per-rule rows.
- Console: "Énergie" section on the doors page (or its own page) — rules CRUD +
  savings card ("38 kWh économisés ce mois").
- Honest scope: Attendyo emits the on/off signals to the buyer's relay/BMS endpoint
  (their own LAN URL) or runs in simulation; it is not itself an HVAC controller.

### Deferred to roadmap (do NOT half-build)
- Full 3D/floor-plan digital twin (v3 map is isometric zone-level; plan import later).
- Continuous multi-camera re-identification (v3 tracks door crossings).
- Knowledge graph over projects/devices/trainings/certifications (needs new entity
  admin; the Ask engine over people/departments/zones/attendance ships now, the
  graph entities come with their own release).

### i18n & settings — completion contract (v3)
- Every Console/Gate string lives in the i18n layer; **fr/en/ar are all complete**
  (page bodies included, not just nav). `ar` renders RTL correctly on every page.
- `timeAgo`/dates/numbers localize by `branding.locale`.
- Settings apply **everywhere, live**: locale (all pages+Gate), terminology (all
  labels), colors (all tokens incl. map/IQ/Ask surfaces), workday+grace (late math,
  overtime math), `min_revisit_seconds`, `alert_cooldown_seconds`. PUT →
  BrandingProvider refresh must repaint without a reload.

## Branding tokens (consumed by Console + Gate)

`GET /api/settings → branding`: `product_name`, `tagline`, `primary_color`,
`accent_color`, `logo_url`, `locale ("fr"|"en"|"ar")`. UIs must read these, never
hard-code the brand — that is what makes Attendyo white-label.

## Reconciliation notes (as-built)

Small clarifications made during implementation; the running system follows these:

- **Browser-credential endpoints accept `?token=<jwt>`.** `EventSource` (SSE) and
  `window.open`/direct-download links (`/api/attendance/export.csv`) cannot set an
  `Authorization` header, so both also accept the operator JWT as a `token` query
  param. Header wins when both are present.
- **`GET /api/settings` is readable by a device key too.** It accepts either an
  operator JWT or a valid `X-Device-Key`, so the Gate kiosk (which holds only the
  device key) can theme itself from the customer's white-label branding. `PUT`
  remains admin-JWT only.
- **`GET /api/members/{id}/photo`** serves the stored enrolment image; `Member.photo_url`
  points at it. (The `POST .../photo` add-face route is unchanged.)
- **`decision: "denied"`** is a reserved value in the enum; the default rule set emits
  the more specific `unknown_face` / `not_authorized` / `off_schedule` instead. Clients
  must still handle `denied` for custom rule sets.
- **The SSE `access` payload is a superset of `AccessEvent`** (it also carries
  `door_opened`). Treat unknown keys as ignorable.
- **`/health` may return `status: "degraded"`** (not just `"ok"`) when the DB or engine
  is unreachable, alongside the per-dependency fields.
