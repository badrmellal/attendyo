# Pricing (suggested)

> **These figures are SUGGESTED list prices for positioning and discussion — not a
> binding quote.** Final pricing is set by the integrator/reseller per deal, region, and
> scope. All amounts in **MAD** (Moroccan dirham) unless noted. Liwan is sold as a
> **one-time perpetual on-prem licence**; there is no mandatory subscription.

---

## 1. The model in one line

**Pay once, own it forever, run it on your own server.** The licence is tied to a **site**
(one physical location / one server install) and scales by the **number of enrolled
people** — not by the number of doors. Add as many doors and cameras as the site needs;
there is no per-door licence and no per-seat fee.

---

## 2. One-time perpetual licence tiers

| Tier         | Enrolled people | Doors        | Typical buyer                                  | One-time licence (MAD) |
|--------------|-----------------|--------------|------------------------------------------------|------------------------|
| **Starter**  | up to 100       | 1–2          | Small office, one residence building, clinic   | **18,000**             |
| **Business** | up to 500       | up to 4      | SME, branch, small municipality                | **39,000**             |
| **Pro**      | up to 2,000     | up to 8      | Mid enterprise, bank branch network node, residence complex | **79,000**  |
| **Enterprise**| up to 10,000   | up to 16     | HQ, campus, government agency, industrial zone  | **149,000**            |
| **Site+ / Unlimited** | 10,000+ | 16+ / custom | Large campus, multi-building site, national agency | **Custom quote**   |

Notes:

- **Unlimited faces within the tier band**, bounded only by your server's disk/RAM — never
  by firmware. The bands above are comfort/segmentation, not a hard technical ceiling.
- **Doors are guidance, not a lock.** One server drives many doors; the door counts size
  the typical install, they are not metered.
- A tier upgrade is a **one-time delta** to the next band's price, not a re-purchase.

---

## 3. Optional annual support & updates

Entirely optional — the software keeps working forever without it. Recommended for banks,
government, and any site that wants patches and help.

| Plan                | What you get                                                                 | Price (annual)            |
|---------------------|------------------------------------------------------------------------------|---------------------------|
| **None**            | Perpetual licence keeps running; community/docs only.                         | 0                         |
| **Standard support**| Security/engine updates, email support, best-effort response.                | **18 % of licence / yr**  |
| **Premium support** | Above + priority response, remote-assisted upgrades, install health reviews. | **25 % of licence / yr**  |

> Percentage is of the **one-time licence price** of the tier purchased. First year is
> often bundled into the deal at the integrator's discretion.

---

## 4. Typical add-ons (one-time, optional)

| Add-on                                   | Indicative one-time (MAD) |
|------------------------------------------|---------------------------|
| On-site installation & commissioning     | 5,000 – 15,000 (by site size / doors) |
| Door hardware integration per door (relay wiring, test) | 1,500 – 4,000 / door |
| White-label / partner branding setup     | 4,000 – 10,000            |
| Operator training (half-day, on-site)    | 3,000                     |
| Data migration / bulk enrolment          | by volume                 |

> Hardware (cameras, tablets, relays, strikes, the server) is **not** included in the
> licence — buy commodity gear or let the integrator source it. Liwan runs on a plain CPU
> box you likely already own.

---

## 5. Why the one-time model beats per-terminal hardware (the math)

The dominant alternative in Morocco is **buying a face terminal per door** (e.g. ZKTeco
uFace302 ≈ **850–5,500 MAD/device**, capped at ~3,000 faces each) and often paying for a
**cloud time-attendance subscription** on top. That cost **grows with every door and every
year**. Liwan is **one server, one fee, every door, forever.**

**Worked example — a residence/office with 8 doors, 600 people, viewed over 5 years.**

| | Per-terminal + cloud (illustrative) | Liwan (Business/Pro tier) |
|---|---|---|
| Door terminals | 8 × ~3,500 MAD ≈ **28,000** | 0 (commodity cameras/tablets, bought once) |
| Face capacity | ~3,000/terminal — **need to manage caps** | **Unlimited within tier** |
| Software licence | bundled per device | **one-time** (Pro: 79,000 once) |
| Cloud/SaaS attendance | ~ **subscription, recurring every year** | **0 — runs on your LAN** |
| Year 2–5 recurring | subscription × 4 more years | **0** (support optional) |
| Data location | often vendor cloud | **stays on your LAN (CNDP-friendly)** |

The hardware-terminal route looks cheaper on day one for a couple of doors, but the
**recurring SaaS line and the per-door multiplication** are where it loses over a 3–5 year
horizon — and it can't match "data never leaves the building." Liwan's curve is **flat
after purchase.**

> Competitor figures (ZKTeco device price/cap, cloud attendance) are **public-market
> ranges used illustratively** for comparison; verify current vendor quotes for any real
> bid. See [`COMPARISON.md`](COMPARISON.md) for the feature-level table.

---

## 6. Discounting & deal guidance (for the reseller)

- **Volume / multi-site:** discount the licence for 3+ sites under one customer; consider a
  framework agreement for government/bank rollouts.
- **Government & banks** typically want **Premium support** and on-prem TLS + the full
  compliance posture (see [`../docs/SECURITY-COMPLIANCE.md`](../docs/SECURITY-COMPLIANCE.md)) —
  price the support and install accordingly.
- **Residential complexes** are price-sensitive but feel the **lost-card pain** acutely —
  lead with Starter/Business and the "no cards to replace, ever" story.
- **First-year support** is a good concession to include rather than discounting the
  perpetual licence itself.

> Everything on this page is a **suggested** framework. Adapt to the customer; put the firm
> numbers in the formal quote.
