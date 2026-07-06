# ATTENDYO Bridge — headless camera worker

The Bridge is for **fixed cameras** (RTSP IP cameras or USB cameras) at doors
where there is **no kiosk browser**. It pulls frames, runs a cheap presence
gate, and posts candidate frames to the Attendyo API recognition endpoint. The API
does all the decisioning — threshold, access group, schedule, attendance
roll-up, and firing the door driver. The Bridge never decides access itself and
never talks to the vision engine or the door hardware directly.

```
Camera (RTSP/USB) ─► Bridge ─► POST /api/recognize (X-Device-Key) ─► Attendyo API
```

On-prem, CPU-only, no cloud calls. One worker thread per camera; reconnects on
stream drop.

---

## What it does per camera

1. Open the source with OpenCV; reconnect with exponential backoff if it drops.
2. **Presence gate** — only frames with recent motion *and* a detected frontal
   face are considered, so an empty corridor never hits the API.
3. **Throttle** — at most ~1 request / `1.5s` per camera.
4. **Debounce** — after a `granted` decision the camera stays quiet for
   `BRIDGE_DEBOUNCE_SECONDS` so the same person is not posted repeatedly;
   non-grant decisions use a short 2.5s window so a real new arrival is retried
   quickly.
5. POST the JPEG as multipart (`image`, `camera_id`, `door_id`) with the
   `X-Device-Key` header, then log the returned `RecognizeResult`.

---

## Configuration (environment)

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `ATTENDYO_API_URL` | yes | — | Attendyo API base, e.g. `http://attendyo-api:8088` |
| `ATTENDYO_DEVICE_KEY` | yes | — | Shared device secret sent as `X-Device-Key` |
| `CAMERAS` | one of these | — | Inline JSON array of cameras (offline path) |
| `CAMERAS_FILE` | for cameras | — | Path to a JSON file of cameras |
| `ATTENDYO_OPERATOR_EMAIL` | for API discovery | — | Operator login to call `GET /api/cameras` |
| `ATTENDYO_OPERATOR_PASSWORD` | for API discovery | — | Operator password |
| `BRIDGE_REQUEST_INTERVAL_S` | no | `1.5` | Min seconds between POSTs per camera |
| `BRIDGE_DEBOUNCE_SECONDS` | no | `8.0` | Quiet window after a `granted` decision |
| `BRIDGE_MOTION_MIN_AREA_FRAC` | no | `0.012` | Frame fraction that must change to "wake" |
| `BRIDGE_FRAME_MAX_WIDTH` | no | `960` | Downscale wider frames before upload |
| `BRIDGE_JPEG_QUALITY` | no | `85` | JPEG quality for the upload (50–95) |
| `BRIDGE_RECONNECT_BACKOFF_S` | no | `2.0` | Initial reconnect backoff |
| `BRIDGE_RECONNECT_BACKOFF_MAX_S` | no | `30.0` | Max reconnect backoff |
| `BRIDGE_HTTP_TIMEOUT_S` | no | `15.0` | HTTP timeout for API calls |
| `BRIDGE_LOG_LEVEL` | no | `INFO` | `DEBUG` / `INFO` / `WARNING` / `ERROR` |

### Camera discovery — two ways

**1. Local JSON (offline-first, recommended for air-gapped sites).**
No operator credentials needed. The integrator pins exactly which streams this
box pulls. Each entry needs a `source` and the `camera_id` the API uses for
decisioning (and usually a `door_id`):

```json
[
  {
    "name": "Main Entrance",
    "source": "rtsp://operator:Passw0rd@192.168.1.64:554/Streaming/Channels/101",
    "camera_id": "11111111-1111-1111-1111-111111111111",
    "door_id":   "22222222-2222-2222-2222-222222222222"
  },
  {
    "name": "Lobby USB",
    "source": "0",
    "camera_id": "33333333-3333-3333-3333-333333333333",
    "door_id":   "44444444-4444-4444-4444-444444444444"
  }
]
```

`camera_id` / `door_id` come from Attendyo (Console → Doors/Cameras, or
`GET /api/cameras`). They let the API apply the right threshold, access group,
and schedule. A `disabled` camera can be parked with `"enabled": false`.

Pass inline:

```bash
export CAMERAS='[{"name":"Main","source":"rtsp://...","camera_id":"...","door_id":"..."}]'
```

…or from a file:

```bash
export CAMERAS_FILE=/etc/attendyo/cameras.json
```

**2. From the API.** Leave `CAMERAS` / `CAMERAS_FILE` unset and instead provide
operator credentials; the Bridge logs in and calls `GET /api/cameras`:

```bash
export ATTENDYO_OPERATOR_EMAIL=admin@attendyo.local
export ATTENDYO_OPERATOR_PASSWORD=attendyo-admin
```

(That endpoint is bearer-authed per the contract, so the device key alone is not
enough to list cameras — it only opens `/api/recognize`.)

If both are present, local JSON wins.

---

## Pointing it at a camera

### Hikvision (and most ONVIF) RTSP

Hikvision main/sub stream URL pattern:

```
rtsp://<user>:<pass>@<ip>:554/Streaming/Channels/<ch><stream>
```

- `101` = channel 1, main stream (full res). `102` = channel 1, **sub** stream
  (lower res) — prefer the sub stream for the Bridge: it is lighter on CPU and
  bandwidth and is plenty for face capture at a door.
- URL-encode special characters in the password (`@` → `%40`, etc.).

Example (sub stream):

```
rtsp://operator:Passw0rd@192.168.1.64:554/Streaming/Channels/102
```

Dahua pattern, for reference:

```
rtsp://<user>:<pass>@<ip>:554/cam/realmonitor?channel=1&subtype=1
```

RTSP is forced over **TCP** in the container (`OPENCV_FFMPEG_CAPTURE_OPTIONS`)
for reliability behind building NAT/switches.

### USB camera

Use the device index as a string source: `"0"` for the first camera, `"1"` for
the second, etc. (A bare integer string is opened as a local device; anything
else is treated as a URL.) USB only works on bare-metal / when the device is
passed into the container (`--device /dev/video0`).

---

## Running

### Docker Compose (with the rest of Attendyo)

The Bridge is in `docker-compose.yml` under the `cameras` profile so it only
starts when you ask for it. It already inherits `ATTENDYO_API_URL` and
`ATTENDYO_DEVICE_KEY` from compose; add your camera discovery vars to `.env`:

```bash
# .env
ATTENDYO_DEVICE_KEY=change-me-device-shared-secret
CAMERAS_FILE=/etc/attendyo/cameras.json   # or inline CAMERAS=...
```

Then:

```bash
docker compose --profile cameras up -d attendyo-bridge
docker compose logs -f attendyo-bridge
```

To use a USB camera, add a device mapping to the `attendyo-bridge` service
(`devices: ["/dev/video0:/dev/video0"]`).

### Standalone container

```bash
docker build -t attendyo-bridge ./services/bridge

docker run --rm \
  -e ATTENDYO_API_URL=http://192.168.1.10:8088 \
  -e ATTENDYO_DEVICE_KEY=change-me-device-shared-secret \
  -e CAMERAS='[{"name":"Main","source":"rtsp://operator:Passw0rd@192.168.1.64:554/Streaming/Channels/102","camera_id":"...","door_id":"..."}]' \
  attendyo-bridge
```

### Bare metal (dev)

```bash
cd services/bridge
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt

export ATTENDYO_API_URL=http://localhost:8088
export ATTENDYO_DEVICE_KEY=change-me-device-shared-secret
export CAMERAS='[{"name":"Webcam","source":"0","camera_id":"...","door_id":"..."}]'

python -m src.bridge
```

---

## Logs you'll see

```
ATTENDYO Bridge starting | api=http://attendyo-api:8088 cameras=2 interval=1.5s debounce=8.0s
started worker cam:Main Entrance
cam:Main Entrance | stream connected
cam:Main Entrance | decision=granted who=Amine Z. sim=0.931 dir=in door_opened=True
cam:Main Entrance | decision=unknown_face who=(no match) sim=— dir=unknown door_opened=False
```

`granted` logs at INFO; `not_authorized` / `off_schedule` / `denied` log at
WARNING. The Bridge itself never opens a door — it only reports what the API
decided.

---

## Tuning notes

- **Too many requests / CPU high** → raise `BRIDGE_REQUEST_INTERVAL_S` or
  `BRIDGE_MOTION_MIN_AREA_FRAC`, or point the source at the camera's sub stream.
- **Same person counted twice** → raise `BRIDGE_DEBOUNCE_SECONDS`. (The API also
  debounces per `attendance.min_revisit_seconds`; this is a second, local guard
  that also saves bandwidth.)
- **Misses fast walkers** → lower `BRIDGE_MOTION_MIN_AREA_FRAC` and/or
  `BRIDGE_REQUEST_INTERVAL_S`.
- **Recognition accuracy** (threshold, detection probability) is owned by the
  API/camera settings, not the Bridge. Adjust those in Attendyo.
