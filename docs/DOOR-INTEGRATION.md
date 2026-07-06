# Door integration

How Attendyo turns a `granted` decision into an open door — and how to wire that to real
hardware. Each door in the database carries a **driver** and a **`driver_config`** JSON
blob; the API fires the matching driver when a recognition is `granted`, and re-locks
after `relock_seconds`.

Driver shapes are defined in [`../db/schema.sql`](../db/schema.sql); this document is the
integrator's guide with worked examples.

---

## 1. The three drivers

From the `doors` table (`driver` ∈ `webhook | pi_gpio | simulation`):

| Driver       | When to use                                                | `driver_config`                                  |
|--------------|------------------------------------------------------------|--------------------------------------------------|
| `webhook`    | Any network relay that takes an HTTP request (Shelly, ESP32, a PLC, a smart-lock bridge). The most common choice. | `{ url, method, on_grant, on_deny, headers }`    |
| `pi_gpio`    | A Raspberry Pi (or compatible) driving a relay on a GPIO pin, on the LAN. | `{ pin, active_high, host }`                      |
| `simulation` | Pilots, demos, and screen-only doors. Logs the decision and pushes it to the Gate UI; actuates nothing. | `{}`                                             |

Common door fields (all drivers):

- `direction` — `in | out | both`. Refines attendance in/out on direction-aware doors.
- `relock_seconds` — how long the strike stays released after a grant (default 5).
- `enabled` — turn a door off without deleting it.

---

## 2. The webhook contract

When a decision is `granted`, the API sends an HTTP request to `driver_config.url`:

- **Method**: `driver_config.method` (default `POST`).
- **Headers**: any in `driver_config.headers` (e.g. an auth token for the relay).
- **Body**: the JSON object in `driver_config.on_grant` — sent verbatim. Put whatever
  your relay expects here.

On a **denied / unknown / not-authorized / off-schedule** decision, the API sends
`driver_config.on_deny` the same way **if it is present** (omit it if your relay should
simply do nothing on denial — most do).

A reference `driver_config` for a generic HTTP relay:

```json
{
  "url": "http://192.168.1.50/relay/0",
  "method": "POST",
  "headers": { "Authorization": "Bearer relay-secret" },
  "on_grant": { "state": "open",  "ms": 5000 },
  "on_deny":  { "state": "closed" }
}
```

What the relay receives on a grant:

```http
POST /relay/0 HTTP/1.1
Host: 192.168.1.50
Authorization: Bearer relay-secret
Content-Type: application/json

{ "state": "open", "ms": 5000 }
```

The relay is responsible for the physical pulse and (ideally) its own relock. Attendyo also
relocks logically after `relock_seconds`; set the relay's own pulse to match.

**Timeouts & failure:** the API treats the webhook as best-effort with a short timeout.
If the relay errors or times out, the decision is still recorded as `granted` with a
`reason` noting the driver failure, so operators see it in the live monitor. The door
simply did not actuate — Attendyo never "fails open."

---

## 3. Worked example — generic HTTP relay

Any device exposing an HTTP endpoint. Suppose a relay board at `192.168.1.50` opens when
it receives `POST /relay/0` with `{"on":true}`:

```json
{
  "url": "http://192.168.1.50/relay/0",
  "method": "POST",
  "on_grant": { "on": true },
  "on_deny":  { "on": false }
}
```

Create the door and test it:

```bash
curl -s -X POST $API/api/doors \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Main Entrance","driver":"webhook","direction":"both","relock_seconds":5,
       "driver_config":{"url":"http://192.168.1.50/relay/0","method":"POST",
                        "on_grant":{"on":true},"on_deny":{"on":false}}}'

curl -s -X POST $API/api/doors/<door-uuid>/open -H "Authorization: Bearer $TOKEN"
```

---

## 4. Worked example — Shelly relay

[Shelly](https://www.shelly.com/) relays (Shelly 1 / 1PM / Plus 1) speak a simple HTTP
API on the LAN — a popular, cheap, reliable choice for a door strike.

**Gen-1 Shelly** — `GET /relay/0?turn=on&timer=5` opens for 5 seconds and auto-relocks:

```json
{
  "url": "http://192.168.1.51/relay/0?turn=on&timer=5",
  "method": "GET",
  "on_grant": {}
}
```

**Shelly Plus / Gen-2 (RPC)** — `POST /rpc/Switch.Set` with a JSON body:

```json
{
  "url": "http://192.168.1.51/rpc/Switch.Set",
  "method": "POST",
  "on_grant": { "id": 0, "on": true, "toggle_after": 5 },
  "on_deny":  { "id": 0, "on": false }
}
```

> `toggle_after` lets the Shelly relock itself; keep it equal to the door's
> `relock_seconds`. Wire the Shelly's relay (dry contact) in series with the door strike's
> power per the strike's voltage — see wiring notes (§7).

---

## 5. Worked example — ESP32

A tiny ESP32 next to the door, running a sketch that listens for an HTTP request and
pulses a GPIO into a relay module. Point the webhook at it:

```json
{
  "url": "http://192.168.1.52/open",
  "method": "POST",
  "headers": { "X-Door-Secret": "shared-with-the-sketch" },
  "on_grant": { "ms": 5000 }
}
```

Minimal ESP32 (Arduino) handler for `/open` — pulse a relay on GPIO 26 for the requested
milliseconds:

```cpp
#include <WiFi.h>
#include <WebServer.h>

const int RELAY_PIN = 26;            // -> relay module IN
const char* DOOR_SECRET = "shared-with-the-sketch";
WebServer server(80);

void handleOpen() {
  if (server.header("X-Door-Secret") != DOOR_SECRET) { server.send(403); return; }
  int ms = 5000;                                       // default pulse
  // (parse {"ms": …} from server.arg("plain") if you want it dynamic)
  digitalWrite(RELAY_PIN, HIGH);                       // release strike
  delay(ms);
  digitalWrite(RELAY_PIN, LOW);                        // relock
  server.send(200, "application/json", "{\"opened\":true}");
}

void setup() {
  pinMode(RELAY_PIN, OUTPUT); digitalWrite(RELAY_PIN, LOW);
  WiFi.begin("LAN-SSID", "LAN-PASS");
  while (WiFi.status() != WL_CONNECTED) delay(250);
  server.on("/open", HTTP_POST, handleOpen);
  server.begin();
}
void loop() { server.handleClient(); }
```

> Give the ESP32 a static DHCP lease so its IP in `driver_config.url` stays stable.

---

## 6. Worked example — Raspberry Pi GPIO

Two options.

**A) `pi_gpio` driver** — the API talks to a small Attendyo GPIO agent on the Pi:

```json
{
  "pin": 17,
  "active_high": true,
  "host": "192.168.1.53"
}
```

- `pin` — BCM pin number driving the relay.
- `active_high` — `true` if the relay closes when the pin is HIGH (most opto-isolated
  relay boards are **active-low**, so set `false` for those).
- `host` — the Pi's LAN address.

**B) `webhook` driver to a tiny Flask service on the Pi** — if you'd rather run your own
endpoint:

```python
# door_relay.py  — runs on the Raspberry Pi
from flask import Flask, request
from gpiozero import OutputDevice
import time

# active_high=False matches a common active-LOW relay board
relay = OutputDevice(17, active_high=False, initial_value=False)
app = Flask(__name__)
SECRET = "shared-with-attendyo"

@app.post("/open")
def open_door():
    if request.headers.get("X-Door-Secret") != SECRET:
        return ("forbidden", 403)
    ms = int((request.json or {}).get("ms", 5000))
    relay.on()                      # release strike
    time.sleep(ms / 1000)
    relay.off()                     # relock
    return {"opened": True}

# run: flask --app door_relay run --host 0.0.0.0 --port 8090
```

```json
{
  "url": "http://192.168.1.53:8090/open",
  "method": "POST",
  "headers": { "X-Door-Secret": "shared-with-attendyo" },
  "on_grant": { "ms": 5000 }
}
```

---

## 7. Wiring & relock notes (read before touching mains)

> ⚠️ **Electrical safety.** Door strikes and maglocks often run on 12/24 V and can be tied
> to fire/life-safety systems. Have a qualified electrician do the wiring and confirm it
> meets local fire codes. The notes below are integration guidance, not an electrical
> standard.

- **Use the relay as a dry contact.** Attendyo/relays switch a low-voltage *control* signal;
  the strike's own power supply drives the lock. Do not source lock current from the
  relay logic.
- **Fail-safe vs fail-secure.** A **fail-secure** strike stays locked with no power (opens
  only when energised) — typical for access control. A **fail-safe** / maglock *unlocks*
  on power loss — required on some egress doors by fire code. Choose per door and per law;
  this changes how `on_grant`/`on_deny` and the relay's normally-open/normally-closed
  contacts must be wired.
- **Relock timing.** Keep three numbers consistent: the door's `relock_seconds`, the
  relay/device auto-off timer (e.g. Shelly `toggle_after`, ESP32 pulse `ms`), and any
  door-controller hold. 5 seconds is a sane default for a person to push through.
- **Flyback protection.** Strikes/maglocks are inductive — fit a flyback diode (DC) or
  snubber (AC) across the lock coil to protect the relay contacts.
- **Free egress.** People must always be able to leave. Don't gate exit on recognition for
  a door that is also a fire exit — use a request-to-exit button / hardware egress, and
  set the door `direction` to `in` so Attendyo controls entry only.
- **Two doors, one server.** Each door is its own row with its own driver and relay; one
  Attendyo box drives many doors over the LAN. There is no per-door licence.

---

## 8. Quick reference

```jsonc
// webhook
{ "driver": "webhook",
  "driver_config": { "url": "...", "method": "POST|GET",
                     "headers": { },
                     "on_grant": { /* sent on granted */ },
                     "on_deny":  { /* optional; sent on denials */ } } }

// pi_gpio
{ "driver": "pi_gpio",
  "driver_config": { "pin": 17, "active_high": false, "host": "192.168.1.53" } }

// simulation (demos / screen-only)
{ "driver": "simulation", "driver_config": { } }
```

Test any door without a face using the contract's test pulse:

```bash
curl -s -X POST $API/api/doors/<door-uuid>/open -H "Authorization: Bearer $TOKEN"
```
