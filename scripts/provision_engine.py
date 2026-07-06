#!/usr/bin/env python3
"""
provision_engine.py — one-command bootstrap of the Attendyo Vision Engine.

Instead of opening the engine console at :8000 and clicking through it, an
installer runs this once after `docker compose up -d`:

    python scripts/provision_engine.py \
        --email admin@example.com --password 'a-strong-password' --write-env

It talks to the engine's internal admin HTTP API (stdlib only, LAN only) and:

  1. registers the first engine admin user (idempotent — "already exists" is fine),
  2. logs in and captures an access token,
  3. creates (or finds) the application,
  4. creates (or finds) a RECOGNITION service under it,
  5. prints the recognition API key, and
  6. with --write-env, writes it into .env as ENGINE_API_KEY.

The admin endpoints are internal to the engine and can differ between engine
versions, so every step is best-effort with precise error output. If any step
fails, the script explains the manual fallback and exits non-zero — it never
tracebacks in an installer's face.

Manual fallback (always works): open the engine console at http://<server>:8000,
create an application, add a service of type "Recognition", copy its API key,
and paste it into .env as ENGINE_API_KEY.
"""

from __future__ import annotations

import argparse
import base64
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

DEFAULT_ENGINE_URL = "http://localhost:8000"
DEFAULT_APP_NAME = "attendyo"
DEFAULT_SERVICE_NAME = "attendyo-recognition"
TIMEOUT_S = 20

FALLBACK_MSG = (
    "Fallback: open the engine console at :8000 and create a Recognition "
    "service manually, then paste the key into .env as ENGINE_API_KEY."
)


class StepError(Exception):
    """A provisioning step failed; message is already human-readable."""


# --------------------------------------------------------------------------
# Tiny HTTP layer (stdlib only — no external dependencies on an air-gapped box)
# --------------------------------------------------------------------------

def _request(
    method: str,
    url: str,
    *,
    body: bytes | None = None,
    headers: dict[str, str] | None = None,
) -> tuple[int, Any]:
    """Perform one HTTP request; return (status, parsed-JSON-or-text)."""
    req = urllib.request.Request(url, data=body, method=method)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as res:
            raw = res.read().decode("utf-8", errors="replace")
            status = res.status
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        status = e.code
    except urllib.error.URLError as e:
        raise StepError(
            f"cannot reach the engine at {url!r}: {e.reason}. "
            "Is the stack up (`docker compose ps`) and port 8000 reachable?"
        ) from e
    except TimeoutError as e:
        raise StepError(f"request to {url!r} timed out after {TIMEOUT_S}s") from e

    try:
        return status, json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError:
        return status, raw


def post_json(url: str, payload: dict[str, Any], token: str | None = None) -> tuple[int, Any]:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return _request("POST", url, body=json.dumps(payload).encode(), headers=headers)


def get_json(url: str, token: str | None = None) -> tuple[int, Any]:
    headers: dict[str, str] = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return _request("GET", url, headers=headers)


def _summary(data: Any, limit: int = 300) -> str:
    text = data if isinstance(data, str) else json.dumps(data, ensure_ascii=False)
    text = " ".join(text.split())
    return text[:limit] + ("…" if len(text) > limit else "")


# --------------------------------------------------------------------------
# Provisioning steps
# --------------------------------------------------------------------------

def register_admin(base: str, email: str, password: str,
                   first_name: str, last_name: str) -> None:
    """Step 1 — register the first engine admin user (idempotent)."""
    status, data = post_json(
        f"{base}/admin/user/register",
        {
            "email": email,
            "password": password,
            "firstName": first_name,
            "lastName": last_name,
        },
    )
    if 200 <= status < 300:
        print(f"[1/4] admin user registered: {email}")
        return
    # An existing account is fine — the login step will confirm the password.
    if status in (400, 409) and "exist" in _summary(data).lower():
        print(f"[1/4] admin user already exists: {email} (continuing)")
        return
    raise StepError(
        f"registering the engine admin failed (HTTP {status}): {_summary(data)}. "
        "If an admin was already created with a different email/password, "
        "re-run with those credentials."
    )


def login(base: str, email: str, password: str) -> str:
    """Step 2 — log in and capture an access token.

    Engine versions differ: newer builds accept a JSON login, older builds use
    an OAuth password grant with a fixed public client id. Try both.
    """
    # Attempt A: plain JSON login.
    status, data = post_json(
        f"{base}/admin/user/login", {"email": email, "password": password}
    )
    if 200 <= status < 300 and isinstance(data, dict):
        token = data.get("access_token") or data.get("token")
        if isinstance(token, str) and token:
            print("[2/4] logged in (user login endpoint)")
            return token

    # Attempt B: OAuth password grant (public client id, empty secret).
    form = urllib.parse.urlencode(
        {
            "grant_type": "password",
            "scope": "all",
            "username": email,
            "password": password,
        }
    ).encode()
    basic = base64.b64encode(b"CommonClientId:").decode()
    status_b, data_b = _request(
        "POST",
        f"{base}/admin/oauth/token",
        body=form,
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": f"Basic {basic}",
        },
    )
    if 200 <= status_b < 300 and isinstance(data_b, dict):
        token = data_b.get("access_token")
        if isinstance(token, str) and token:
            print("[2/4] logged in (oauth token endpoint)")
            return token

    raise StepError(
        "login failed on both known endpoints — "
        f"/admin/user/login → HTTP {status}: {_summary(data)}; "
        f"/admin/oauth/token → HTTP {status_b}: {_summary(data_b)}. "
        "Check the email/password, or the engine version may use a different "
        "auth flow."
    )


def _find_by_name(items: Any, name: str) -> dict[str, Any] | None:
    """Find an object whose 'name' matches, in a list or {content:[…]} page."""
    if isinstance(items, dict):
        items = items.get("content") or items.get("data") or []
    if not isinstance(items, list):
        return None
    for it in items:
        if isinstance(it, dict) and it.get("name") == name:
            return it
    return None


def ensure_app(base: str, token: str, app_name: str) -> str:
    """Step 3 — create the application, or find it if it already exists."""
    status, data = post_json(f"{base}/admin/app", {"name": app_name}, token)
    if 200 <= status < 300 and isinstance(data, dict) and data.get("id"):
        print(f"[3/4] application created: {app_name}")
        return str(data["id"])

    # It may already exist — look it up.
    status_l, data_l = get_json(f"{base}/admin/apps", token)
    if 200 <= status_l < 300:
        found = _find_by_name(data_l, app_name)
        if found and found.get("id"):
            print(f"[3/4] application already exists: {app_name} (reusing)")
            return str(found["id"])

    raise StepError(
        f"creating application {app_name!r} failed (HTTP {status}): "
        f"{_summary(data)}; and it was not found in the existing list "
        f"(HTTP {status_l}). The admin API shape may differ on this engine "
        "version."
    )


def _extract_api_key(model: dict[str, Any]) -> str | None:
    for key in ("apiKey", "api_key", "accessKey", "key"):
        val = model.get(key)
        if isinstance(val, str) and val:
            return val
    return None


def ensure_recognition_service(base: str, token: str, app_id: str,
                               service_name: str) -> str:
    """Step 4 — create a RECOGNITION service under the app; return its API key."""
    status, data = post_json(
        f"{base}/admin/app/{app_id}/model",
        {"name": service_name, "type": "RECOGNITION"},
        token,
    )
    if 200 <= status < 300 and isinstance(data, dict):
        key = _extract_api_key(data)
        if key:
            print(f"[4/4] recognition service created: {service_name}")
            return key

    # It may already exist — list the app's services and reuse.
    status_l, data_l = get_json(f"{base}/admin/app/{app_id}/models", token)
    if 200 <= status_l < 300:
        found = _find_by_name(data_l, service_name)
        if found:
            key = _extract_api_key(found)
            if key:
                print(f"[4/4] recognition service already exists: {service_name} (reusing)")
                return key

    raise StepError(
        f"creating the recognition service failed (HTTP {status}): "
        f"{_summary(data)}; listing existing services gave HTTP {status_l}. "
        "The admin API shape may differ on this engine version."
    )


# --------------------------------------------------------------------------
# .env writing
# --------------------------------------------------------------------------

def write_env(env_path: Path, api_key: str) -> None:
    """Replace (or append) the ENGINE_API_KEY line in the given .env file."""
    if not env_path.exists():
        raise StepError(
            f"{env_path} does not exist — copy .env.example to .env first, "
            "or pass --env-file."
        )
    text = env_path.read_text(encoding="utf-8")
    line = f"ENGINE_API_KEY={api_key}"
    pattern = re.compile(r"^\s*#?\s*ENGINE_API_KEY\s*=.*$", flags=re.MULTILINE)
    if pattern.search(text):
        text = pattern.sub(line, text, count=1)
    else:
        if text and not text.endswith("\n"):
            text += "\n"
        text += line + "\n"
    env_path.write_text(text, encoding="utf-8")
    print(f"      wrote ENGINE_API_KEY into {env_path}")


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Bootstrap the Attendyo Vision Engine: register the admin, create the "
            "application and Recognition service, and print the API key."
        ),
        epilog=FALLBACK_MSG,
    )
    parser.add_argument("--engine-url", default=DEFAULT_ENGINE_URL,
                        help=f"engine base URL (default {DEFAULT_ENGINE_URL})")
    parser.add_argument("--email", required=True,
                        help="engine admin email to register / log in with")
    parser.add_argument("--password", required=True,
                        help="engine admin password")
    parser.add_argument("--first-name", default="Attendyo",
                        help="admin first name (default: Attendyo)")
    parser.add_argument("--last-name", default="Admin",
                        help="admin last name (default: Admin)")
    parser.add_argument("--app-name", default=DEFAULT_APP_NAME,
                        help=f"application name (default {DEFAULT_APP_NAME})")
    parser.add_argument("--service-name", default=DEFAULT_SERVICE_NAME,
                        help=f"recognition service name (default {DEFAULT_SERVICE_NAME})")
    parser.add_argument("--write-env", action="store_true",
                        help="write the key into the .env file as ENGINE_API_KEY")
    parser.add_argument("--env-file", default=None,
                        help=".env path for --write-env (default: <repo>/.env)")
    args = parser.parse_args(argv)

    base = args.engine_url.rstrip("/")
    try:
        register_admin(base, args.email, args.password,
                       args.first_name, args.last_name)
        token = login(base, args.email, args.password)
        app_id = ensure_app(base, token, args.app_name)
        api_key = ensure_recognition_service(base, token, app_id,
                                             args.service_name)
    except StepError as e:
        print(f"\nERROR: {e}", file=sys.stderr)
        print(FALLBACK_MSG, file=sys.stderr)
        return 1
    except Exception as e:  # never traceback in an installer's face
        print(f"\nERROR: unexpected failure: {e.__class__.__name__}: {e}",
              file=sys.stderr)
        print(FALLBACK_MSG, file=sys.stderr)
        return 1

    print("\nRecognition API key:")
    print(f"  {api_key}")

    if args.write_env:
        env_path = (
            Path(args.env_file)
            if args.env_file
            else Path(__file__).resolve().parent.parent / ".env"
        )
        try:
            write_env(env_path, api_key)
        except StepError as e:
            print(f"\nERROR: {e}", file=sys.stderr)
            print(f"Paste this line into your .env manually:\n"
                  f"  ENGINE_API_KEY={api_key}", file=sys.stderr)
            return 1
        print("\nDone. Restart the API so it picks up the key:")
        print("  docker compose up -d attendyo-api")
    else:
        print("\nPaste it into .env as ENGINE_API_KEY (or re-run with "
              "--write-env), then:")
        print("  docker compose up -d attendyo-api")

    return 0


if __name__ == "__main__":
    sys.exit(main())
