# Operations runbook

Day-to-day tasks for the people who run Liwan — HR, reception, security, facility
managers. Each task is given two ways: the **Console** (the web dashboard, the normal
way) and the **API** (for scripts and integrations). API shapes are normative in
[`../CONTRACT.md`](../CONTRACT.md).

> Conventions below: `API` = `http://<server-ip>:8088`. Operator calls need a bearer
> token; get one first.

```bash
# Get an operator token (used by the curl examples below)
TOKEN=$(curl -s $API/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@liwan.local","password":"<your-password>"}' \
  | python -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
```

---

## 1. Enrol a person from one photo

**One clear, front-facing photo is all it takes.** It creates the CompreFace subject and
the face embedding in a single call, and the person is recognisable immediately.

**In the Console**

1. People → **Add person**.
2. Fill name and the relevant fields: `member_type` (employee / resident / contractor /
   visitor), department/title (or apartment number in `external_id` for a residence),
   email/phone, and **access group**.
3. Drop in the photo. Save.
4. The new person appears in the list as `active` and can be recognised at any door their
   access group allows.

**Via the API**

```bash
curl -s -X POST $API/api/members \
  -H "Authorization: Bearer $TOKEN" \
  -F 'full_name=Yassine El Amrani' \
  -F 'member_type=employee' \
  -F 'department=Finance' \
  -F 'title=Comptable' \
  -F 'access_group_id=<group-uuid>' \
  -F 'image=@/path/to/photo.jpg'
```

**Photo tips for clean recognition**

- Face the camera, neutral expression, both eyes visible, no heavy backlight.
- One face in the frame. Glasses are fine; sunglasses and masks are not.
- A passport-style or phone selfie at arm's length works well.
- To improve robustness later, add a second photo with
  `POST /api/members/{id}/photo` (optional — not required to be recognised).

---

## 2. Run a daily attendance report

The attendance record is **one row per person per day**: first entry in the morning,
last exit in the evening, hours worked, and a status of `present | late | absent |
incomplete`. **Absent people are included** — the report returns everyone for the date,
not only those who showed up.

**In the Console**

1. Attendance → pick a date.
2. See every member with `first_in`, `last_out`, worked hours, and a status pill
   (emerald present, gold late, red absent).
3. Filter by department or status; search by name.

**Via the API**

```bash
# Everyone, for one day (absent included)
curl -s "$API/api/attendance?date=2026-06-19" -H "Authorization: Bearer $TOKEN"

# A date range
curl -s "$API/api/attendance?from=2026-06-01&to=2026-06-19" -H "Authorization: Bearer $TOKEN"

# One person's history
curl -s "$API/api/attendance/<member-uuid>?from=2026-06-01&to=2026-06-19" \
  -H "Authorization: Bearer $TOKEN"
```

**Reading the statuses**

- **present** — came in on time (and, where applicable, has a sensible in/out).
- **late** — first entry after `workday_start + grace_minutes` (site settings).
- **incomplete** — entered but no clean exit captured (e.g. left by an un-monitored door).
- **absent** — no `granted` event that day.

Late thresholds come from **site settings** (`workday_start`, `workday_end`,
`grace_minutes`). Adjust them per site if your hours differ from the 09:00 / 10-min
defaults.

---

## 3. Export attendance to CSV

For payroll, HR systems, or an auditor.

**In the Console** — Attendance → **Export CSV** (respects the current date/range and
filters).

**Via the API**

```bash
# One day
curl -s "$API/api/attendance/export.csv?date=2026-06-19" \
  -H "Authorization: Bearer $TOKEN" -o attendance-2026-06-19.csv

# A range
curl -s "$API/api/attendance/export.csv?from=2026-06-01&to=2026-06-19" \
  -H "Authorization: Bearer $TOKEN" -o attendance-june.csv
```

The CSV is plain `text/csv` (member, department, date, first-in, last-out, worked, status)
— open it in Excel/LibreOffice or feed it to payroll. Everything stays on your machine.

---

## 4. Add a door

A door is a controlled passage with a driver (how it physically opens) and one or more
cameras.

**In the Console**

1. Doors → **Add door**: name, location, **direction** (`in` / `out` / `both`),
   **driver** (`webhook` / `pi_gpio` / `simulation`), `relock_seconds`.
2. Fill the driver config for your relay — see
   [`DOOR-INTEGRATION.md`](DOOR-INTEGRATION.md) for every driver's JSON.
3. **Test it**: use the door's **Test pulse** button before going live.
4. Cameras → **Add camera**: bind it to the door, set the source (`rtsp://…` or a webcam
   index), and tune `recognition_threshold` / `det_prob_threshold` for that spot's
   lighting.
5. Make sure each member who should pass is in an **access group** that includes this door
   (an empty `door_ids` list means *all doors*).

**Via the API**

```bash
# Create a door (webhook relay)
curl -s -X POST $API/api/doors \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{
        "name":"Main Entrance","location":"Lobby","direction":"both",
        "driver":"webhook","relock_seconds":5,
        "driver_config":{"url":"http://192.168.1.50/relay","method":"POST",
                         "on_grant":{"state":"open"},"on_deny":{"state":"closed"}}
      }'

# Test pulse (does it physically open?)
curl -s -X POST $API/api/doors/<door-uuid>/open -H "Authorization: Bearer $TOKEN"

# Bind a camera to it
curl -s -X POST $API/api/cameras \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Lobby cam","door_id":"<door-uuid>","source":"rtsp://192.168.1.60/stream",
       "recognition_threshold":0.88,"det_prob_threshold":0.80}'
```

---

## 5. Watch the live monitor

Both the Console live monitor and the Gate kiosk subscribe to the same server-sent event
stream — every decision appears the instant it's made.

- **Console → Live monitor**: a running feed of decisions (granted / denied / unknown /
  not authorized / off schedule) with name, door, similarity, and time.
- **Gate (:3001)**: greets recognised people by name and animates the door-open pulse.

For an integration, subscribe directly:

```bash
curl -N "$API/api/events/stream" -H "Authorization: Bearer $TOKEN"
# emits:  event: access\n data: { …AccessEvent… }
```

Query historical events with filters:

```bash
curl -s "$API/api/events?date=2026-06-19&decision=denied&limit=100" \
  -H "Authorization: Bearer $TOKEN"
```

---

## 6. White-label the deployment

Branding is data, not code. Change it once and both the Console and the Gate follow.

**In the Console** — Settings → Branding: product name, tagline, primary/accent colours,
logo, locale (`fr` / `en` / `ar`).

**Via the API** (admin only):

```bash
curl -s -X PUT $API/api/settings \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"branding":{"product_name":"Bab","tagline":"Votre porte vous connaît.",
        "primary_color":"#5663F2","accent_color":"#E0A340","logo_url":null,"locale":"fr"}}'
```

The UIs read these tokens from `GET /api/settings` and never hard-code "Liwan" — this is
what makes the same install shippable under a partner's brand.

---

## 7. Daily ops runbook (the short version)

A reception/security checklist for a normal day.

**Morning**

1. Glance at the dashboard: `GET /api/stats/today` (Console home) — `present`, `late`,
   `absent`, `on_site_now`, `denied_today`. Anything wildly off is the first thing to
   investigate.
2. Confirm `/health` is all `ok` (Console shows a status indicator).
3. Spot-check the Gate at the main door greets a known person.

**During the day**

- Keep the **live monitor** visible at reception. Repeated `unknown_face` at one door can
  mean a lighting change (clean the lens, re-tune `recognition_threshold`) or a genuine
  stranger.
- A `denied` / `not_authorized` for someone who *should* have access → check their
  `status` is `active` and their access group includes that door + time window.
- New starter or new resident → **enrol them (§1)** and assign the access group.

**End of day / weekly**

- Export the day's (or week's) attendance CSV for HR/payroll (§3).
- Archive leavers: set their member `status` to `archived` (revokes access, keeps the
  history). Delete only when retention policy says so (see
  [`SECURITY-COMPLIANCE.md`](SECURITY-COMPLIANCE.md)).
- Confirm last night's backup ran (see [`INSTALL.md`](INSTALL.md) §6).

**Common fixes**

| Situation                                  | Do this                                                              |
|--------------------------------------------|---------------------------------------------------------------------|
| Known person not recognised                | Re-enrol with a clearer photo; add a second photo; check lighting.  |
| Person recognised but door won't open      | Door **test pulse**; check driver config / relay wiring.            |
| Someone left the company still has access  | Set member `status = suspended` or `archived`.                      |
| Attendance shows `incomplete` a lot        | A monitored exit door is missing — add an `out` door/camera.        |
| Wrong people marked `late`                 | Adjust the site's `workday_start` / `grace_minutes`.                |
