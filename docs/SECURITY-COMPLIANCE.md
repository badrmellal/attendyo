# Security & compliance

Attendyo processes **biometric data** (face images and the templates derived from them).
In Morocco that makes it **sensitive personal data** under **Law 09-08** and brings it
under the supervision of the **CNDP** (Commission Nationale de contrôle de la protection
des Données à caractère Personnel). This document explains what the *architecture* gives
you, and — just as importantly — **what the buyer still has to do**. None of it is legal
advice; engage qualified counsel and your DPO.

> **Plain statement of fact, and of limits.** Attendyo is built so that biometric data stays
> on your premises. That is an architectural fact. It does **not**, by itself, make a
> deployment "compliant." Compliance is a process — authorisation, notice, consent or
> another legal basis, retention, security, and accountability — that the controller (the
> buyer) owns. Attendyo is a tool that makes that process much easier; it is not a
> certificate.

---

## 1. Data residency — on-prem by design

- **Everything runs on your LAN.** The recognition engine, the database, the API, and both
  web apps are containers on one box you control.
- **No cloud, no telemetry, no third-party SaaS** sits in the recognition or storage path.
  There is no call-home, no analytics beacon, and no licence server to contact at runtime.
- **Outbound internet is needed once**, to pull Docker images at install. After that the
  box can be air-gapped (see [`INSTALL.md`](INSTALL.md) §7) and will run indefinitely
  offline.
- **The data never crosses a border.** For Law 09-08, cross-border transfer of personal
  data is tightly controlled; an on-prem system that never sends data abroad removes that
  whole problem class. (You must still keep it that way operationally — see §6 on backups.)

This is the strongest part of the Attendyo compliance story: the data physically cannot leak
to a vendor cloud because there is no vendor cloud in the loop.

---

## 2. Morocco Law 09-08 & the CNDP (what the buyer must do)

Deploying biometric attendance/access in Morocco is **not** a plug-and-play matter — the
CNDP treats biometrics as sensitive and expects controllers to justify and authorise the
processing. As the **data controller**, the buyer is responsible for, at minimum:

1. **Authorisation / declaration with the CNDP.** Biometric processing generally requires
   prior authorisation (not merely a declaration). File it before going live. Be ready to
   justify *why* face recognition is necessary and proportionate versus less-intrusive
   alternatives (badges, PIN) — proportionality is central to how the CNDP assesses
   biometrics.
2. **A lawful basis & transparency.** Inform data subjects (employees, residents,
   visitors) clearly: who controls the data, why, what is collected, how long it's kept,
   and their rights (access, rectification, objection). Post notices at monitored doors.
3. **Consent or a documented alternative basis.** For employees, consent is often not
   freely given (power imbalance); rely on a properly justified legitimate basis and offer
   a **non-biometric alternative** where required (e.g. a manual register), and document
   that choice.
4. **Data-subject rights.** Have a process to honour access/rectification/erasure requests
   — Attendyo supports this operationally (delete a member removes their engine subject;
   see §5).
5. **Security & retention measures** proportionate to the sensitivity (this document and
   the controls below help, but the buyer must adopt and enforce them).
6. **A register of processing** and, where appropriate, a risk/impact assessment.

> The exact forms, thresholds, and whether an authorisation vs. simplified regime applies
> can change. **Confirm the current CNDP requirements and file the correct paperwork with
> legal counsel before deployment.** Attendyo does not file anything on your behalf and makes
> no representation that any specific deployment is authorised.

---

## 3. GDPR alignment (for multinationals / EU ties)

Many Moroccan banks, subsidiaries, and government partners also touch the EU **GDPR**.
Attendyo's design aligns with several GDPR principles, though alignment is not certification:

- **Data minimisation (Art. 5).** One photo per person; only the fields you choose to
  enter. No surplus collection.
- **Storage limitation (Art. 5).** Retention is configurable and enforced by the buyer
  (§6).
- **Privacy by design & by default (Art. 25).** On-prem, fail-closed, LAN-only, no
  external sharing.
- **Special-category data (Art. 9).** Biometrics for unique identification are special
  category; the buyer needs an Art. 9 condition (and usually a **DPIA**, Art. 35) — Attendyo
  gives you the technical posture, you provide the legal basis and the DPIA.
- **Security of processing (Art. 32).** See the controls in §4.

---

## 4. Security controls

What Attendyo provides, and how to operate it safely.

**In the product**

- **Fail closed.** If the engine or DB is unavailable, recognition cannot grant — the door
  stays shut. There is no "fail open." (See [`ARCHITECTURE.md`](ARCHITECTURE.md) §8.)
- **Separation of duties.** Console operators are `users` with roles
  (`admin | operator | viewer`), entirely separate from the enrolled `members`.
- **Two distinct credentials.** Operators authenticate with a JWT bearer
  (`ATTENDYO_JWT_SECRET`); devices/kiosks authenticate the recognition endpoint with a
  shared `X-Device-Key` (`ATTENDYO_DEVICE_KEY`). They are not interchangeable.
- **Per-door, per-time authorisation.** Access groups bind members to specific doors and
  schedules; off-door or off-schedule access is denied and logged.
- **Full audit trail.** Every decision — granted *and* denied — is written to
  `access_events` with similarity, door, time, and reason. Attendance is a reproducible
  roll-up of that trail.
- **Append-only operator audit log.** Beyond door decisions, every mutating *operator*
  action — logins, member create/update/delete/import, door and camera changes, manual
  door opens, access-group and settings changes, team-account changes, alert
  acknowledgements — is written to `audit_log` with the acting user's identity (from
  their JWT), the action, the entity, and details. The API exposes it read-only to
  admins (`GET /api/audit`); there is no update or delete path, so "who changed what,
  when" is answerable and defensible in an internal or regulator audit.

**What the buyer must configure**

- **Change every default secret** on first run: `postgres_password`, `ATTENDYO_JWT_SECRET`,
  `ATTENDYO_ADMIN_PASSWORD`, `ATTENDYO_DEVICE_KEY`, and the `admin@attendyo.local` password. The
  defaults in `.env.example` are placeholders, not credentials.
- **Lock down the network.** Publish only Console/Gate/API on the LAN; keep Postgres
  (5432) and the engine console (8000) internal. Use a host firewall and, ideally, a
  TLS reverse proxy so logins/tokens are encrypted even on the LAN. (See
  [`INSTALL.md`](INSTALL.md) §5.)
- **Least privilege for operators.** Give reception `viewer`/`operator`, reserve `admin`
  for the few who manage settings and enrolment.
- **Physical security.** The server box and door tablets are part of the trust boundary —
  lock the rack, secure the tablets in kiosk mode, protect backups.
- **Patch.** Pin and update the engine images and the host OS on a schedule.

---

## 5. Are the templates reversible to photos? (No — and what that means)

A common, fair question from security and privacy reviewers.

- The recognition engine stores a **face *template*** (a numeric embedding) used to
  compare faces. **A template is not a photograph** and is **not designed to be
  reversed** into the original image — it's a one-way feature vector for matching, not a
  compressed picture.
- **Caveat, stated honestly:** "not reversible to the original photo" is **not** the same
  as "anonymous." A template is still **biometric personal data** — it can identify a
  person — and must be protected as such under Law 09-08 / GDPR. Do not treat templates as
  non-personal just because they aren't pictures.
- **Attendyo also stores the enrolment image and event snapshots** by default
  (`save_images_to_db=true`, plus the media volume) so operators can verify matches. Those
  **are** images and are unambiguously personal data. If your policy forbids retaining
  source images, you can reduce snapshot/image retention (§6) — at the cost of
  visual auditability.
- **Erasure works at the source:** deleting a member (`DELETE /api/members/{id}`) removes
  the engine subject (its template) as well as the Attendyo record, satisfying a
  right-to-erasure request for that person's biometric data.

---

## 6. Retention & access control

Retention is a policy you set and Attendyo enforces operationally.

- **Decide retention windows up front**, per data class, and document them:
  - **Enrolment images / templates** — for the lifetime of the person's relationship with
    the site (employee tenure, residency). Remove on departure (archive then delete).
  - **Access events** — keep as long as your security/audit policy and the law require,
    then purge. Events drive attendance, so coordinate with payroll retention.
  - **Event snapshots** — usually the shortest window; they're the most sensitive (live
    images of people at a door).
- **Enforce it.** Archive leavers (`status = archived`) to revoke access while keeping
  history; **delete** (member + subject) when retention expires. Periodically purge old
  events/snapshots per your schedule. (Hooks/queries for scheduled purging are an
  operations task — see [`OPERATIONS.md`](OPERATIONS.md).)
- **Protect backups like the live system.** Backups contain biometric-derived data:
  encrypt them, store them on-prem or in approved storage, restrict who can restore, and
  apply the *same* retention — a "deleted" person must not live forever in an old dump.
- **Log and limit access to the data itself.** Restrict DB and server access to named
  administrators; the operator console already scopes what each role can see.

---

## 7. What Attendyo does NOT claim

To keep this honest and sellable to banks and government without overpromising:

- **No certifications are claimed.** Attendyo is not stated to be ISO 27001, SOC 2, CNDP-
  "approved," or GDPR-"certified." Those are organisational/process certifications that a
  product alone cannot confer. Where a tender requires them, they attach to the
  *deploying organisation* and its processes, not to this software by default.
- **Attendyo is not a legal basis.** Installing it does not authorise biometric processing;
  the CNDP authorisation and the lawful basis are the controller's to obtain.
- **Accuracy is probabilistic.** Face recognition has false-accept/false-reject rates that
  vary with lighting, camera, and population. Tune thresholds per camera, and keep a
  human-in-the-loop fallback for high-stakes doors.

---

## 8. Buyer's compliance checklist

A short, practical list to hand to the customer's DPO / security team.

- [ ] CNDP authorisation/declaration filed and granted for biometric processing.
- [ ] Lawful basis documented; non-biometric alternative offered where required.
- [ ] Privacy notices posted at all monitored doors; data-subject rights process in place.
- [ ] DPIA / risk assessment completed (especially if GDPR also applies).
- [ ] All default secrets changed; admin password rotated; roles assigned least-privilege.
- [ ] Network locked down (firewall, LAN-only, Postgres/8000 internal, TLS on the LAN).
- [ ] Retention windows defined per data class and enforced (archive/delete + purge job).
- [ ] Backups encrypted, access-controlled, and on the same retention.
- [ ] Register of processing updated; DPO informed; counsel signed off.

> This checklist is a starting point, not a substitute for legal advice. Requirements
> evolve — verify current Law 09-08 / CNDP and (where relevant) GDPR obligations with
> qualified professionals before go-live.
