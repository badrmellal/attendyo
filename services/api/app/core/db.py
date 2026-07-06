"""Postgres access layer.

A small, dependency-light wrapper around ``psycopg2`` using a thread-safe
``SimpleConnectionPool``. Every connection has ``search_path`` pinned to the
``attendyo`` schema so callers never need to qualify table names.

All helpers are synchronous (psycopg2 is blocking). Routers must call them off
the event loop via ``asyncio.to_thread`` / ``run_in_threadpool`` — never inline
in an ``async def`` body.
"""

from __future__ import annotations

import logging
import threading
from contextlib import contextmanager
from typing import Any, Iterator, Sequence

import psycopg2
import psycopg2.extras
from psycopg2.pool import SimpleConnectionPool

from .config import get_settings

logger = logging.getLogger("attendyo.db")

_pool: SimpleConnectionPool | None = None
_pool_lock = threading.Lock()


def init_pool() -> None:
    """Create the global connection pool (idempotent)."""
    global _pool
    with _pool_lock:
        if _pool is not None:
            return
        settings = get_settings()
        _pool = SimpleConnectionPool(
            minconn=settings.db_min_conn,
            maxconn=settings.db_max_conn,
            dsn=settings.dsn,
            # Pin search_path at connect time for every pooled connection.
            options="-c search_path=attendyo,public",
        )
        logger.info("Database pool initialised (%s..%s connections)",
                    settings.db_min_conn, settings.db_max_conn)


def close_pool() -> None:
    """Close all pooled connections (graceful shutdown)."""
    global _pool
    with _pool_lock:
        if _pool is not None:
            _pool.closeall()
            _pool = None
            logger.info("Database pool closed")


def _require_pool() -> SimpleConnectionPool:
    if _pool is None:
        init_pool()
    assert _pool is not None  # for type-checkers
    return _pool


@contextmanager
def get_conn() -> Iterator["psycopg2.extensions.connection"]:
    """Borrow a connection from the pool, returning it afterwards.

    Commits on clean exit, rolls back on exception. The ``search_path`` is set
    defensively on each checkout because a misbehaving driver could reset it.
    """
    pool = _require_pool()
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute("SET search_path TO attendyo, public")
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        pool.putconn(conn)


@contextmanager
def get_cursor() -> Iterator[psycopg2.extras.RealDictCursor]:
    """Borrow a dict-returning cursor (rows as plain ``dict``)."""
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            yield cur


def query_all(sql: str, params: Sequence[Any] | None = None) -> list[dict[str, Any]]:
    """Run a SELECT and return all rows as dicts."""
    with get_cursor() as cur:
        cur.execute(sql, params or ())
        return [dict(row) for row in cur.fetchall()]


def query_one(sql: str, params: Sequence[Any] | None = None) -> dict[str, Any] | None:
    """Run a SELECT and return the first row as a dict, or ``None``."""
    with get_cursor() as cur:
        cur.execute(sql, params or ())
        row = cur.fetchone()
        return dict(row) if row is not None else None


def execute(sql: str, params: Sequence[Any] | None = None) -> int:
    """Run an INSERT/UPDATE/DELETE without RETURNING. Returns affected row count."""
    with get_cursor() as cur:
        cur.execute(sql, params or ())
        return cur.rowcount


def execute_returning(
    sql: str, params: Sequence[Any] | None = None
) -> dict[str, Any] | None:
    """Run a statement with RETURNING and return the produced row as a dict."""
    with get_cursor() as cur:
        cur.execute(sql, params or ())
        row = cur.fetchone()
        return dict(row) if row is not None else None


def ping() -> bool:
    """Cheap connectivity probe for /health. Never raises."""
    try:
        with get_cursor() as cur:
            cur.execute("SELECT 1")
            cur.fetchone()
        return True
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("DB ping failed: %s", exc)
        return False
