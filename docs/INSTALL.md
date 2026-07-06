# Installation — on-prem, single box

Attendyo installs on **one machine on your LAN**. There is no cloud account, no licence
server to phone home, and no internet dependency at runtime. This guide takes a clean
server to a working system with a door kiosk.

> Audience: the installer / integrator. For day-to-day operator tasks (enrol someone,
> run a report) see [`OPERATIONS.md`](OPERATIONS.md).

---

## 1. What you need

**Software**

- Linux (Ubuntu 22.04 LTS or similar) — Windows Server / macOS work for a pilot, Linux
  for production.
- **Docker Engine 24+** and the **Docker Compose v2** plugin.
- That's it. Postgres, the recognition engine, the API, and both web apps come as
  containers.

**Network**

- A wired LAN the server and door tablets share.
- A **static IP** (or DHCP reservation) for the server, e.g. `192.168.1.10`.
- No inbound internet. Outbound internet is needed **only once**, to pull the Docker
  images during install; after that the box can be fully offline (air-gapped sites:
  pre-pull/transfer the images — see §7).

---

## 2. CPU sizing guidance

Attendyo is CPU-only (the recognition core ships in a MobileNet build). Size by the number
of **doors / simultaneous recognitions** and the **enrolled population**, not by GPU.

| Site profile                         | People enrolled | Doors | Recommended box                                  |
|--------------------------------------|-----------------|-------|--------------------------------------------------|
| Pilot / small office / one residence | up to ~300      | 1–2   | 4 vCPU, 8 GB RAM, 60 GB SSD                       |
| Mid enterprise / branch / municipality| ~300–2,000     | 2–6   | 8 vCPU, 16 GB RAM, 120 GB SSD                     |
| Large HQ / campus / industrial zone  | 2,000–10,000+   | 6–16  | 16 vCPU, 32 GB RAM, 250 GB SSD (NVMe)            |

Notes:

- **Enrolled-face count is bounded by disk/RAM, not firmware.** Unlike hardware terminals
  (e.g. ~3,000 faces/device), Attendyo has no hard cap; the table above is comfort, not a
  ceiling.
- **Recognition latency is driven by CPU cores × core concurrency** (`uwsgi_processes`,
  `uwsgi_threads`), not by population size.
- **Disk** is dominated by stored enrolment images and event snapshots
  (`save_images_to_db=true`). Budget for retention (see [`SECURITY-COMPLIANCE.md`](SECURITY-COMPLIANCE.md)).
- Start with the JVM/uWSGI defaults in `.env.example`; raise on bigger boxes (see
  [`ARCHITECTURE.md`](ARCHITECTURE.md) §7).

---

## 3. Install

```bash
# 0) Get the Attendyo bundle onto the server (git clone, scp, or USB for air-gapped).
cd attendyo

# 1) Configure.
cp .env.example .env
```

Edit `.env` and change **every** secret before the box touches a real network:

| Variable               | Why it matters                                                     |
|------------------------|--------------------------------------------------------------------|
| `postgres_password`    | Database superuser. Never leave `change-me-in-production`.          |
| `ATTENDYO_JWT_SECRET`     | Signs operator sessions. Use a long random string (32+ chars).     |
| `ATTENDYO_ADMIN_PASSWORD` | First admin login. Change here and again in Console → Settings.     |
| `ATTENDYO_DEVICE_KEY`     | Shared secret every Gate/Bridge presents as `X-Device-Key`.         |
| `ENGINE_API_KEY`       | Filled in step 4 — `scripts/provision_engine.py` writes it for you. |

Generate strong secrets, for example:

```bash
openssl rand -hex 32      # good for ATTENDYO_JWT_SECRET / ATTENDYO_DEVICE_KEY
```

```bash
# 2) Bring up the stack.
docker compose up -d

# 3) Watch it become healthy.
docker compose ps
curl -s http://localhost:8088/health      # engine + DB status must be "ok"
```

```bash
# 4) Provision the vision engine (one command, one time).
#    Registers the engine admin account, creates the application and its
#    Recognition service, prints the API key, and writes it into .env:
python scripts/provision_engine.py \
  --email admin@example.com --password 'a-strong-password' --write-env
#    Then restart the API so it picks up the key:
docker compose up -d attendyo-api
```

```text
#    Fallback (if the script cannot complete on your engine version):
#    open the engine console in a browser:
http://<server-ip>:8000
#    → create an application → add a service of type "Recognition"
#    → copy the generated API key → paste it into .env as ENGINE_API_KEY
#    → docker compose up -d attendyo-api
```

```bash

# 5) Seed a demo site, doors, an access group and a few members (optional).
python scripts/seed_demo.py

# 6) Verify the surfaces from another LAN machine:
#      Console : http://<server-ip>:3000   (login admin@attendyo.local / your password)
#      Gate    : http://<server-ip>:3001   (point a wall tablet here)
```

For fixed RTSP cameras (no tablet at the door), enable the Bridge:

```bash
docker compose --profile cameras up -d attendyo-bridge
```

---

## 4. Wire up a door tablet (Gate kiosk)

1. Mount a tablet (or small all-in-one) at the door, on the same LAN.
2. Open a browser to `http://<server-ip>:3001`, allow camera access.
3. Put the browser in kiosk / fullscreen mode and disable sleep.
4. In the Console, add the door + camera and pick a driver
   (see [`DOOR-INTEGRATION.md`](DOOR-INTEGRATION.md)). Use the door's **test pulse** button
   (`POST /api/doors/{id}/open`) to confirm the relay fires before going live.

---

## 5. LAN & firewall

Expose only what each audience needs; keep the rest internal to the Docker network.

| Port | Expose to              | Notes                                                              |
|------|------------------------|-------------------------------------------------------------------|
| 3000 | operator workstations  | Console. Restrict to admin/HR subnet if possible.                 |
| 3001 | door tablets           | Gate. Restrict to the door-tablet VLAN.                           |
| 8088 | apps, tablets, Bridge  | Attendyo API. LAN only.                                              |
| 8000 | installer, briefly     | Engine console. Close after setup, or restrict to admins.         |
| 5432 | nobody                 | Postgres. **Keep internal** to the Docker network — do not publish.|

Recommended host firewall (ufw example, adjust subnets):

```bash
sudo ufw default deny incoming
sudo ufw allow from 192.168.1.0/24 to any port 3000 proto tcp   # Console
sudo ufw allow from 192.168.1.0/24 to any port 3001 proto tcp   # Gate
sudo ufw allow from 192.168.1.0/24 to any port 8088 proto tcp   # API
# 8000 only while installing; remove the rule afterwards:
sudo ufw allow from 192.168.1.0/24 to any port 8000 proto tcp
sudo ufw enable
```

**No inbound rule from the internet is required or recommended.** Attendyo is a LAN product.
If remote admin is genuinely needed, terminate it through a VPN into the LAN — never
publish these ports to the public internet.

**TLS on the LAN (recommended for banks/government):** put a reverse proxy (Caddy or
nginx) in front of the Console, Gate, and API with an internal CA or self-signed certs so
operator logins and tokens travel encrypted even inside the building.

---

## 6. Backups

What to back up and how. All of it is local.

- **PostgreSQL** — the system of record (members, events, attendance, settings, the
  engine's subjects/embeddings). A nightly dump:

  ```bash
  docker exec attendyo-postgres-db \
    pg_dump -U postgres -d attendyo -Fc > /backups/attendyo-$(date +%F).dump
  ```

  Restore:

  ```bash
  cat /backups/attendyo-YYYY-MM-DD.dump | \
    docker exec -i attendyo-postgres-db pg_restore -U postgres -d attendyo --clean --if-exists
  ```

- **Media volume** — stored enrolment images and event snapshots live in the
  `attendyo-media` Docker volume (mounted at `/data/media` in the API). Back it up:

  ```bash
  docker run --rm -v attendyo-media:/data -v /backups:/backup alpine \
    tar czf /backup/attendyo-media-$(date +%F).tgz -C /data .
  ```

- **`.env`** — keep a copy of your configured `.env` (with its secrets) in your secrets
  vault. Without it the secrets can't be reproduced.

Test a restore on a spare box at least once. Store backups encrypted, on-prem or in
your organisation's approved storage; remember they contain biometric-derived data —
treat them with the same controls as the live system (see
[`SECURITY-COMPLIANCE.md`](SECURITY-COMPLIANCE.md)).

---

## 7. Air-gapped / fully offline installs

For sites that must never touch the internet:

1. On a machine **with** internet, pull every image referenced by `docker-compose.yml`
   and `docker save` them to a tarball.
2. Transfer the tarball + the `attendyo/` directory by approved media.
3. `docker load` the images on the target box, then run the steps in §3 (skip the pull).

After that, the system runs indefinitely offline. There is no licence call-home and no
telemetry.

---

## 8. Upgrades

- Pin the vision-engine versions in `.env` (`*_VERSION`) so upgrades are deliberate.
- Before upgrading: back up Postgres and the media volume (§6).
- Pull the new Attendyo bundle / images, then `docker compose up -d` to roll forward.
- The schema is idempotent (`CREATE TABLE IF NOT EXISTS …`, seeds use `ON CONFLICT DO
  NOTHING`), so re-applying `db/schema.sql` is safe.

---

## 9. Health & troubleshooting

| Symptom                                   | Check                                                                 |
|-------------------------------------------|-----------------------------------------------------------------------|
| `/health` shows the engine `"down"`       | `docker compose ps`; the engine core/api containers; CPU/RAM pressure.|
| `/health` shows `db: "down"`              | Postgres container up? Volume mounted? Disk full?                     |
| Recognition always `unknown_face`         | Is `ENGINE_API_KEY` set and the API restarted? Lower the camera's `recognition_threshold` slightly; check lighting. |
| Gate can't open camera                    | Browser camera permission; HTTPS may be required by the browser for webcam — use the LAN TLS proxy (§5). |
| Door never actuates on `granted`          | Driver config; use the door **test pulse**; see [`DOOR-INTEGRATION.md`](DOOR-INTEGRATION.md). |

Logs: `docker compose logs -f attendyo-api` (and `attendyo-engine-core` for recognition).
