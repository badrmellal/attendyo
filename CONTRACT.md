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
  decision: AccessEvent["decision"];
  member?: { id: string; full_name: string; department?: string; title?: string };
  similarity?: number; door_opened: boolean; greeting?: string;  // localized welcome line
  direction: "in"|"out"|"unknown";
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
- `GET /api/settings` → `{ branding:{…}, attendance:{…} }`
- `PUT /api/settings` → update (admin only)
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
- Recognition path: every non-granted decision INSERTs an `alerts` row
  (kind = the decision, message localized-neutral, links event/door/member) and publishes
  SSE `event: alert` with the Alert JSON.
- `GET /api/alerts?acknowledged=&kind=&limit=` → `Alert[]`
- `GET /api/alerts/count` → `{ unacknowledged:int }` (badge)
- `POST /api/alerts/{id}/ack` → `Alert` (sets acknowledged_by/at from the JWT)
- `POST /api/alerts/ack-all` → `{ acknowledged:int }`
```ts
type Alert = { id:number; ts:string; kind:"unknown_face"|"not_authorized"|"off_schedule"|"system";
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
