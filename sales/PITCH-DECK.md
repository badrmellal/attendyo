# Pitch deck — outline & speaker notes

A 12-slide narrative for a 10–15 minute sales meeting with a Moroccan enterprise,
residence syndic, bank, municipality, industrial, or **university** buyer. Each slide gives the **on-slide
content** (keep it sparse — visuals over text) and **speaker notes** (what you actually
say). Brand the deck from the deployment's identity; "Liwan / لِيوان" is the default.

> Design language (from `brand/BRAND.md`): the *iwan* arch motif on a warm violet-ink
> field; ultramarine/Majorelle (`#5663F2`) for the brand and "granted"; sand gold
> (`#E0A340`) for premium accents and the arch trace; a Fraunces serif wordmark; generous
> space; tabular numbers for any stats. Calm and sovereign, never hypey.

---

## Slide 1 — Title / cold open

**On slide:** `لِيوان · LIWAN` wordmark. Tagline: *"The threshold that knows your people."*
A single dark hero image: a Moroccan **arch**, an amber line tracing its curve, a name
rising inside it — "Bienvenue, Yassine." Sub-line: *On-prem face access & attendance.
Sold once. Owned forever.*

**Speaker notes:** "A *līwān* is the arched hall that fronts a Moroccan courtyard — the
threshold you pass through to enter. That's the whole product in one word: it stands at
your threshold, recognises the people who belong, opens the door for them, and writes down
when they came and went — all on your own server, nothing in the cloud. Let me show you why
that matters for [their world]."

---

## Slide 2 — The pain (tailor to the room)

**On slide:** three icons + three lines, swapped per audience.
- Residential: *Lost cards. Cloned cards. Re-issuing fees. A notebook for visitors.*
- Bank/Gov: *Biometric data in someone's cloud. Recurring bills. Audit gaps.*
- Industrial/Corporate: *Buddy-punching. A terminal per door. Caps at 3,000 faces.*
- University: *Lent student cards. Signature sheets signed for friends. Open labs.*

**Speaker notes:** "Today you're [losing cards every week / sending staff data to a vendor
cloud / buying a terminal for every door]. Each of those is a cost, a security hole, or a
compliance question. Hold that thought." *(Name the one pain you know they feel — let them
nod before you solve it.)*

---

## Slide 3 — The idea

**On slide:** *Your face is the key.* One photo → recognised at the door → door opens →
the day is logged. A clean 4-step strip.

**Speaker notes:** "One photo enrolls a person. From then on the face is the key — never
lost, never lent, never cloned. The door opens when the system knows you, and every entry
and exit is recorded for the day, automatically. No cards, no PINs, no queue."

---

## Slide 4 — How it works (architecture, simply)

**On slide:** the simplified diagram — *Camera / tablet → Liwan server (recognition + DB) →
door*. Caption: **One server. Many doors. All on your LAN.**

**Speaker notes:** "A camera or a wall tablet sends a face to your Liwan server. The server
recognises it, decides if this person may open this door at this time, opens it, and logs
it. One commodity CPU box drives every door over your local network. Nothing leaves the
building — there's no internet in this picture at all."

---

## Slide 5 — The five differentiators

**On slide:** five tight bullets, emerald ticks.
- One-time perpetual licence — *no subscription*
- On-prem — *data never leaves your LAN*
- Unlimited faces — *no firmware cap*
- Runs on plain CPU — *no GPU, no terminal per door*
- One photo to enroll — *no cards to lose*

**Speaker notes:** "Five things make Liwan different. You **buy it once**. Your **data stays
on your LAN**. You enroll **unlimited people**. It runs on a **plain server** you probably
already have. And you onboard someone with **one photo** — no card to ever lose. Every one
of these is a direct answer to a cost or risk on slide 2."

---

## Slide 6 — Data stays home (the compliance slide)

**On slide:** a building outline with a closed padlock; *Law 09-08 · CNDP · GDPR-aligned.*
Caption: **Biometric data never crosses the building's walls.** Small print: *No
certification claimed; authorisation is the controller's.*

**Speaker notes:** "This is the slide your security and legal people care about. Because
everything runs on-prem, biometric data **never leaves your building or the country** —
that's the hardest thing to say with any cloud product, and it's exactly what the CNDP
scrutinises for biometrics. To be honest and precise: Liwan gives you the *architecture*;
the CNDP authorisation and lawful basis are still yours to obtain. We make that far easier;
we don't pretend to be a certificate." *(Honesty here builds trust with banks/government.)*

---

## Slide 7 — The console & the gate (show it)

**On slide:** two screenshots — the dark **Console** dashboard (present / late / absent /
on-site-now, live monitor) and the fullscreen **Gate** kiosk greeting someone by name.
Caption: *FR · EN · AR.*

**Speaker notes:** "Here's the admin console: today's attendance at a glance, a live feed of
every door decision, people and doors managed in a few clicks, CSV export for payroll. And
here's the gate a visitor sees — a tablet on the wall that greets them by name and opens the
door. French, Arabic, or English. This is a modern web product, not a two-inch terminal
screen." *(If possible, do a 60-second live demo here instead of the screenshot.)*

---

## Slide 8 — Versus the alternatives

**On slide:** the condensed comparison row: **Liwan vs ZKTeco terminal vs Hikvision vs cloud
SaaS** across *cost model, data location, face cap, recurring cost.* Liwan column glows.

**Speaker notes:** "Against a ZKTeco or Hikvision terminal, you avoid buying a box per door
and the ~3,000-face cap, and you keep the data on-prem. Against a cloud attendance service,
you avoid the subscription forever and the data leaving the country. Hardware can be cheaper
for a single door on day one — I'll be straight about that — but across multiple doors and a
few years, Liwan wins on total cost and on sovereignty." *(See COMPARISON.md / PRICING.md.)*

---

## Slide 9 — The cost story

**On slide:** two curves over 5 years — *per-terminal + cloud* climbing; *Liwan* flat after
a one-time step. Caption: **Pay once. Flat forever. Support is optional.**

**Speaker notes:** "Their cost grows with every door and every year of subscription. Ours is
a one-time licence — flat after purchase. Optional annual support if you want updates and a
phone to call, but the software keeps working with or without it. Over three to five years
the gap is decisive." *(Quote the tier that fits their size from PRICING.md — clearly as a
suggested list price.)*

---

## Slide 10 — Built for your vertical

**On slide:** one panel for the buyer in the room — *pain → Liwan answer → trigger* —
pulled from VERTICALS.md (residence / bank / municipality / industrial / corporate /
university).

**Speaker notes:** *(Use only the panel that matches.)* e.g. residential: "For a residence,
the win is simple: the face replaces the card. No more lost badges, no more re-issuing fees,
no more cloned cards at the gate. Move someone in with a photo; move them out by archiving
them — access gone instantly." For a university: "The face is the student card — amphi
presence can't be signed for a friend, exam-hall identity is checked at the door, labs and
the bibliothèque get per-building schedules, and exchange students' access expires by
itself at semester's end. Campus mode relabels the whole console — étudiants, faculté,
rapports per dean — and the rentrée is one CSV import."

---

## Slide 11 — Rollout & what you need

**On slide:** *1) One server (commodity CPU). 2) Cameras / tablets at doors + relays.
3) We install, enroll, train. Live in days.* Caption: *Air-gappable. White-label. Yours.*

**Speaker notes:** "Deployment is light. One server you provide or we spec; commodity
cameras or tablets at the doors; a simple relay per door we wire and test. We install,
help you enroll your people, train your operators, and you're live in days — not a
multi-month integration. It can run fully offline, and it can wear your brand, not ours."

---

## Slide 12 — Close & next step

**On slide:** the wordmark again. *"Buy it once. Own the gate. Keep your data."* One clear
CTA: **Pilot one door, one floor — see it in your building next week.**

**Speaker notes:** "Here's what I propose: a pilot on one door or one floor, in your own
building, on your own server, this/next week. You'll see real recognition, real attendance,
your data staying exactly where it is. If it does what I've said, we scale it across your
site. Shall we set the pilot date?" *(Always close on a concrete pilot, not a brochure.)*

---

### Appendix slides (have ready, don't present unless asked)

- **A1 — Security & fail-closed:** decision ladder, audit trail, roles, what happens if the
  engine is down (door stays shut). From `docs/ARCHITECTURE.md` / `SECURITY-COMPLIANCE.md`.
- **A2 — Door hardware:** supported relays (generic webhook, Shelly, ESP32, Pi GPIO),
  fail-safe vs fail-secure, free-egress note. From `docs/DOOR-INTEGRATION.md`.
- **A3 — Pricing detail:** tiers, optional support %, add-ons, the 5-year math. From
  `sales/PRICING.md` — marked *suggested*.
- **A4 — Compliance checklist:** the buyer's CNDP/GDPR to-do list. From
  `docs/SECURITY-COMPLIANCE.md` §8.

> Presenter rules: tailor slide 2 and slide 10 to the room before you walk in; never claim a
> certification; always close on a one-door pilot. Confidence through restraint — let the
> live demo and the cost curve do the work.
