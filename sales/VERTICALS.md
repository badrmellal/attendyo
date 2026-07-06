# Verticals — who buys Attendyo, and why

Six markets, each with the **pain** they feel today, the **Attendyo answer**, and the
**buying trigger** — the moment the deal becomes urgent. Lead with **residential**: the
lost-RFID-card story is the fastest "yes" in the Moroccan market.

> One install fits all of these: the data model (`member_type` = employee / resident /
> contractor / visitor / student / faculty / staff, generic `members`, access groups,
> daily attendance, validity windows) is deliberately the same product, rebranded and
> re-labelled per buyer (`GET /api/settings → branding`, incl. `terminology` presets).

---

## 1. High-end residential complexes — *lead with this*

**The pain — the lost card that never ends.**
Every resident has an RFID badge for the gate, the parking, the lobby, the lift. They lose
them. They lend them to the nanny, the cleaner, the delivery guy. They get cloned at a
kiosk for 20 dirhams. The syndic spends its week **re-issuing cards, chasing fees, and
re-keying the system** — and a lost card is a security hole until someone notices. Visitor
management is a paper notebook at a guard's desk.

**The Attendyo answer.**
The **face is the key** — nothing to lose, lend, or clone. Enroll a resident from **one
photo** at move-in; the gate and lobby open when they walk up. New tenant? One photo.
Moved out? Archive them and their access is gone instantly — no card to recover. Cleaners
and contractors get **time-boxed access groups** (weekday daytime only). One server runs
**the gate, the lobby, and the parking door**; the syndic sees a modern console instead of
a card spreadsheet. **No cards, no card costs, ever.**

**The buying trigger.**
A wave of lost/cloned cards, a security incident at the gate, a syndic AGM where residents
demand "stop charging us 150 dirhams for a new badge," or a new building handover where the
developer wants a premium, card-free entry as a selling point.

---

## 2. Banks & financial institutions

**The pain.**
Strict access control to branches, server rooms, cash areas, and back offices — with a hard
requirement that **biometric and personal data not leave the institution** (regulator and
CNDP scrutiny). Cloud attendance tools are often a non-starter for compliance. Card+PIN is
shareable and audited poorly. Audit trails must be complete and defensible.

**The Attendyo answer.**
**Fully on-prem** — biometric data never leaves the bank's LAN, the single strongest line
for a compliance review under **Law 09-08 / CNDP**. **Per-door, per-time access groups**
(the vault door open only to two officers, only in business hours), a **complete audit
trail** of every granted *and* denied attempt, **fail-closed** behaviour, and role-based
operator access. Pairs face with existing controls for **two-factor at sensitive doors**.

**The buying trigger.**
An internal audit or regulator finding on physical access; a new branch fit-out; a
cloud-attendance proposal rejected by the security/compliance team; consolidation of
attendance + access onto one auditable, on-prem system.

---

## 3. Government agencies & municipalities

**The pain.**
Staff attendance for payroll and accountability across departments; public-building access
control; tight budgets that resist **recurring** software bills; **data-sovereignty**
expectations (citizen-adjacent data must stay in-country, on government infrastructure);
procurement that favours a **capital purchase** over an open-ended subscription.

**The Attendyo answer.**
A **one-time capital purchase** that fits public-procurement budgeting — no subscription to
renew each fiscal year. **On-prem, in-country, offline-capable** (air-gappable), aligned
with data-sovereignty expectations. **Daily attendance with CSV export** straight into
payroll/HR. **French, Arabic, and English** console. One server covers a building's doors;
roll out site-by-site under a framework agreement.

**The buying trigger.**
A modernisation/digitalisation initiative; an attendance/payroll-integrity mandate; a
rejected cloud bid on sovereignty grounds; end-of-budget capital spend that suits a
one-time licence; a new or renovated public building.

---

## 4. Industrial zones & factories

**The pain.**
High headcount and **shift work**, lots of **contractors and temporary workers** churning
through the gates, **harsh environments** (dust, gloves, helmets) where cards get lost or
damaged, multiple gates spread across a large site, and a need for **accurate hours** for
shift pay and safety head-counts (who is on-site right now).

**The Attendyo answer.**
**Unlimited enrolment** for big, churning populations (no firmware cap), **one-photo**
onboarding for contractors with **time-boxed access groups** that expire, **multiple gates
from one server** over the site LAN, and **first-in/last-out daily attendance** for shift
pay plus an **on-site-now** count for safety/muster. No cards to lose or damage on the
floor. Per-camera thresholds tune for tough lighting at each gate.

**The buying trigger.**
A safety/muster requirement (knowing exactly who is inside), payroll disputes over hours,
contractor-access incidents, expansion adding gates, or scrapping a card system that keeps
breaking in the environment.

---

## 5. Corporate / enterprise offices

**The pain.**
HR wants reliable attendance without buddy-punching; facilities want clean access control
across floors and meeting rooms; IT wants **fewer subscriptions and fewer vendors** holding
employee data; everyone wants something that looks modern, not a beige terminal beeping at
the door.

**The Attendyo answer.**
**No buddy-punching** — your face is your timesheet; **first-in/last-out attendance** with
**CSV export** to the existing HR/payroll system; **floor- and room-level access groups**;
**one on-prem server** instead of another SaaS contract and another copy of staff data in a
vendor cloud; a **modern, brandable web console** that fits the company's identity
(white-label). Scales from a single office to multi-floor HQ on one box.

**The buying trigger.**
An office move or fit-out; an HR push to fix attendance accuracy; a vendor/subscription
consolidation drive; a data-privacy review that flags employee data in a cloud
attendance tool; leadership wanting a visibly modern workplace.

---

## 6. Universités & campus

**The pain — the carte étudiant that proves nothing.**
The student card is lost, lent, or photocopied — a **carte étudiant perdue ou prêtée**
is the campus version of the cloned RFID badge. Amphi attendance is a signature sheet
signed by a friend (**fraude au pointage / proxy attendance**), so the scholarship and
assiduité records are fiction. Labs, the **bibliothèque**, and the **cité universitaire**
need real access control, not a guard glancing at a card. Exam halls need **identity
checks** at the door — is the person sitting the exam the person enrolled? And every
September, thousands of new students and dozens of *vacataires* and exchange students
must be onboarded, and last year's must stop working.

**The Attendyo answer.**
The same install, switched to **campus terminology mode** (`branding.terminology =
"campus"`): the console speaks *Étudiants & Personnel* and *Faculté / École*, with
**student / faculty / staff** member types first. The **face is the student card** —
amphi presence is recorded per person per day, un-lendable, killing proxy attendance;
the same recognition serves as an **exam-hall identity check** at the door. **Per-building
access groups with schedules** put the labs, the bibliothèque, and the cité universitaire
each behind their own doors and hours. **Exchange students and vacataires get temporary
access** (`valid_from` / `valid_until`) that expires by itself at semester's end. The
rentrée is a **CSV import** of the enrolment list plus one photo per person; **reports
per faculté** give each dean their own attendance picture. One server covers the campus;
data stays on the university's own LAN (Law 09-08 / CNDP).

**The buying trigger.**
The **rentrée** (the yearly onboarding crunch), a **new campus building** to secure, a
**security incident** at a residence or lab, an assiduité/scholarship audit that exposes
signature-sheet fraud, or an exam-integrity push after an impersonation case.

---

## Cross-vertical cheat sheet

| Vertical        | Headline pain               | Attendyo one-liner                                              | Trigger to watch for                    |
|-----------------|-----------------------------|-------------------------------------------------------------|-----------------------------------------|
| **Residential** | Lost / cloned RFID cards    | "The face is the key — no cards, no card costs, ever."      | Card incident / syndic AGM / handover   |
| **Banks**       | Data must not leave the bank| "Biometrics never leave your LAN — built for CNDP."         | Audit finding / rejected cloud bid       |
| **Government**  | No recurring bills, sovereignty | "Buy once, own it, in-country, offline-capable."        | Modernisation / capital budget / sovereignty |
| **Industrial**  | Churn, shifts, harsh gates  | "Unlimited faces, many gates, accurate shift hours."       | Safety muster / payroll dispute / expansion |
| **Corporate**   | Buddy-punching, too many SaaS| "Your face is your timesheet — on your server, your brand."| Office move / HR mandate / privacy review |
| **University**  | Lent cards, proxy attendance | "The face is the student card — presence that can't be signed for a friend." | Rentrée / new building / security incident |

> Selling tip: every vertical hears the same three proofs — **one-time on-prem**, **data
> stays on the LAN (CNDP)**, **unlimited faces from one photo, no cards** — but lead with
> the pain that vertical feels first. Residential = the card. Banks/Government =
> sovereignty. Industrial = scale & shifts. Corporate = buddy-punching & vendor sprawl.
