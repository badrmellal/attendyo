"""LIWAN API — on-prem face attendance & access-control backend.

White-label FastAPI service wrapping the Liwan Vision Engine (the bundled
recognition core). Implements the contract in ``liwan/CONTRACT.md`` exactly,
including the v2 endpoints (reports, presence, alerts, audit, users, import).
"""

__version__ = "2.0.0"
