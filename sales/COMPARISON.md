# Comparison — Liwan vs the alternatives

How Liwan stacks up against the options a Moroccan buyer actually weighs: a **ZKTeco face
terminal** (the volume leader), a **Hikvision face terminal** (premium hardware), and a
**cloud face-attendance SaaS**. Use this for tenders and objection handling.

> Competitor details are public-market characteristics used for **factual comparison**;
> trademarks belong to their owners. Verify current specs/quotes for any live bid. Figures
> like the ZKTeco face cap and price band are **illustrative public ranges.**

---

## 1. At-a-glance table

| Dimension                         | **Liwan** | **ZKTeco uFace302** (terminal) | **Hikvision face terminal** | **Cloud face SaaS** |
|-----------------------------------|-----------|--------------------------------|-----------------------------|---------------------|
| Deployment                        | **On-prem software, your server** | Hardware terminal per door | Hardware terminal per door | Vendor cloud |
| Cost model                        | **One-time perpetual licence** | Per-device purchase (~850–5,500 MAD) | Per-device purchase (premium) | **Recurring subscription** |
| Enrolled-face capacity            | **Unlimited (disk/RAM-bound)** | Capped (~3,000 faces/device) | Capped per model | Plan-tiered |
| Doors per server / unit           | **Many doors, one server** | One terminal = one door | One terminal = one door | Depends on edge gear |
| Hardware needed                   | Commodity CPU box + any IP/USB camera or tablet | Proprietary terminal | Proprietary terminal | Edge devices + internet |
| GPU required                      | **No (CPU MobileNet build)** | N/A (embedded) | N/A (embedded) | N/A |
| Data location                     | **Stays on your LAN** | On device / often vendor cloud (ZKBioTime) | On device / vendor platform | **In the cloud** |
| Works fully offline               | **Yes (air-gappable)** | Device yes; cloud features no | Device yes; cloud features no | **No — needs internet** |
| Morocco Law 09-08 / CNDP posture  | **Strong: on-prem, no transfer** | Mixed (cloud features transfer data) | Mixed | **Weak: data leaves country** |
| Enrolment effort                  | **One photo** | Capture at terminal | Capture at terminal | Upload per plan |
| Lost-card problem                 | **Eliminated (face is the key)** | Face or card; cards still optional | Face or card | Varies |
| Attendance (first-in/last-out)    | **Built in, daily roll-up + CSV** | Via ZKBioTime (often cloud/paid) | Via vendor platform | Core feature (paid) |
| Admin experience                  | **Modern web console (FR/EN/AR)** | Device UI + desktop/cloud software | Vendor platform | Web app |
| White-label / rebrand             | **Yes (branding from API)** | No | No | Rarely |
| Recurring cost after year 1       | **0 (support optional)** | Low (device), cloud subscription if used | Cloud subscription if used | **Subscription every year** |
| Vendor lock-in                    | **Low — your box, your data** | Medium–high (ecosystem) | Medium–high | **High** |

---

## 2. Where each alternative wins — and where Liwan answers

**ZKTeco uFace302 (and similar volume terminals)**
- *Their win:* cheapest possible day-one cost for **one or two doors**; all-in-one box,
  nothing to host.
- *Where it hurts:* every door is another terminal; the **~3,000-face cap** bites at scale;
  serious attendance/reporting pushes you to **ZKBioTime cloud** (recurring, data leaves
  the LAN). 
- *Liwan answer:* one server drives **all** doors, **unlimited faces**, attendance and CSV
  built in **on-prem**, **one-time** fee. The hardware route's cost multiplies with doors
  and years; ours is flat after purchase.

**Hikvision face terminal**
- *Their win:* premium build quality, strong camera hardware, big-brand procurement
  comfort.
- *Where it hurts:* still **per-door hardware**, still steered toward the **vendor
  platform**, premium price, and the same data-residency questions for cloud features.
- *Liwan answer:* spend on **commodity cameras** you choose, keep the brains and the data
  **on your server**, pay **once**, and rebrand it as your own.

**Cloud face-attendance SaaS**
- *Their win:* zero servers to run, fast to start, slick dashboards, automatic updates.
- *Where it hurts:* **biometric data in the cloud** — the hardest thing to defend under
  **Law 09-08 / CNDP** (cross-border transfer), **recurring cost forever**, **dead without
  internet**, and you don't own it.
- *Liwan answer:* the same modern web console and daily attendance, but **on your LAN**,
  **offline-capable**, **owned**, with **no subscription** and **no data leaving the
  building**.

---

## 3. The three sentences that win the room

1. **"Buy it once, own it forever — one server runs every door, with no per-terminal
   hardware and no monthly bill."**
2. **"Your faces and your records never leave your building — the strongest possible
   answer to a CNDP / Law 09-08 reviewer."**
3. **"Unlimited people from a single photo each, on a plain CPU box, with a modern web
   console in French, English and Arabic."**

---

## 4. Honest caveats (say these before they ask)

- **Hardware terminals can be cheaper for a single door** on day one. Liwan wins on
  **multiple doors, scale, attendance/reporting, and total cost over 3–5 years** — frame
  the comparison over time, not on day one.
- **Liwan needs a server you run** (one commodity box). That's the price of sovereignty;
  for banks and government it's a feature, not a cost.
- **Recognition is probabilistic** for everyone in this category; tune per-camera
  thresholds and keep a fallback for high-stakes doors. Nobody in this table is magic here.
- **"On-prem" is an architecture, not a certificate.** Liwan makes CNDP/GDPR alignment far
  easier; the authorisation and lawful basis are still the buyer's
  (see [`../docs/SECURITY-COMPLIANCE.md`](../docs/SECURITY-COMPLIANCE.md)).

For the cost arithmetic behind these claims, see [`PRICING.md`](PRICING.md) §5.
