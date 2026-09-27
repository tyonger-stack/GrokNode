#!/usr/bin/env python3
"""Grok Node feishu bridge delivery state machine.

Pure stdlib (Python 3.9, macOS CommandLineTools). Status routing:
2xx -> seen; 409/429/5xx/network -> pending retry; 401 -> hot key refresh then one retry;
404 and other 4xx -> dead. State persists atomically with mode 0600 and the legacy
replied shape migrates into seen. Logs never contain the key or message body.
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import threading
import urllib.error
import urllib.request
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

SEEN_TTL_SECONDS = 7 * 24 * 3600
BACKOFF_SCHEDULE_SECONDS = (5, 10, 30, 60)


def classify_status(status: int) -> str:
    if status <= 0:
        return "retry"
    if 200 <= status < 300:
        return "accept"
    if status in (409, 429) or 500 <= status < 600:
        return "retry"
    if status == 401:
        return "auth"
    return "dead"


def backoff_seconds(attempts: int) -> int:
    if attempts < 1:
        return BACKOFF_SCHEDULE_SECONDS[0]
    return BACKOFF_SCHEDULE_SECONDS[min(attempts - 1, len(BACKOFF_SCHEDULE_SECONDS) - 1)]


class KeyStore:
    """Webhook key with hot refresh: canonical is the container webhook.json, fallback the local file."""

    def __init__(self, docker_cmd: Tuple[str, ...], fallback_file: Path, log: Callable[[str], None]) -> None:
        self._docker_cmd = docker_cmd
        self._fallback_file = fallback_file
        self._log = log
        self._key = ""
        self._key_hash = ""

    def load_initial(self) -> bool:
        self.refresh()
        return bool(self._key)

    def get(self) -> str:
        return self._key

    def refresh(self) -> bool:
        candidate, source = self._read_canonical()
        if candidate is None:
            candidate, source = self._read_fallback()
        if candidate is None:
            self._log("key-refresh-fail no-source-available")
            return False
        new_hash = hashlib.sha256(candidate.encode()).hexdigest()
        changed = new_hash != self._key_hash
        if changed:
            self._key = candidate
            self._key_hash = new_hash
            self._log("key-loaded source=" + source)
        return changed

    def _read_canonical(self) -> Tuple[Optional[str], str]:
        try:
            proc = subprocess.run(self._docker_cmd, capture_output=True, text=True, timeout=10, check=False)
        except (subprocess.SubprocessError, OSError) as err:
            self._log("key-canonical-error " + type(err).__name__)
            return None, ""
        if proc.returncode != 0:
            self._log("key-canonical-fail rc=" + str(proc.returncode))
            return None, ""
        try:
            parsed = json.loads(proc.stdout)
        except ValueError:
            self._log("key-canonical-bad-json")
            return None, ""
        key = parsed.get("key") if isinstance(parsed, dict) else None
        return ((key.strip() or None) if isinstance(key, str) else None), "canonical"

    def _read_fallback(self) -> Tuple[Optional[str], str]:
        try:
            key = self._fallback_file.read_text().strip()
        except OSError:
            return None, ""
        return (key or None), "fallback"


class BridgeState:
    """seen/pending/dead state with atomic persistence and legacy migration. Thread-safe."""

    def __init__(self, path: Path, log: Callable[[str], None]) -> None:
        self._path = path
        self._log = log
        self._data = {"version": 2, "seen": {}, "pending": {}, "dead": {}}
        self._lock = threading.Lock()

    def load(self) -> None:
        try:
            raw = json.loads(self._path.read_text())
        except (OSError, ValueError):
            self._save_locked()
            return
        seen = raw.get("seen", {}) if isinstance(raw, dict) else {}
        replied = raw.get("replied", {}) if isinstance(raw, dict) else {}
        if isinstance(seen, dict) and isinstance(replied, dict):
            seen = {**replied, **seen}
        pending = raw.get("pending", {}) if isinstance(raw.get("pending", {}), dict) else {}
        dead = raw.get("dead", {}) if isinstance(raw.get("dead", {}), dict) else {}
        self._data = {"version": 2, "seen": seen, "pending": pending, "dead": dead}
        self._save_locked()

    def is_known(self, mid: str) -> bool:
        with self._lock:
            return mid in self._data["seen"] or mid in self._data["pending"] or mid in self._data["dead"]

    def enqueue(self, mid: str, payload: Dict[str, object], now: float) -> None:
        with self._lock:
            self._data["pending"][mid] = {"payload": payload, "attempts": 0, "next_at": now, "first_at": now}
            self._prune_locked(now)
            self._save_locked()

    def due_entries(self, now: float) -> List[Tuple[str, Dict[str, object]]]:
        with self._lock:
            return sorted(
                [(mid, entry) for mid, entry in self._data["pending"].items() if entry["next_at"] <= now],
                key=lambda item: item[1]["next_at"],
            )

    def entry(self, mid: str) -> Optional[Dict[str, object]]:
        with self._lock:
            pending = self._data["pending"].get(mid)
            return dict(pending) if pending is not None else None

    def mark_seen(self, mid: str, now: float) -> None:
        with self._lock:
            self._data["pending"].pop(mid, None)
            self._data["seen"][mid] = now
            self._save_locked()

    def mark_retry(self, mid: str, now: float) -> None:
        with self._lock:
            pending = self._data["pending"].get(mid)
            if pending is None:
                return
            pending["attempts"] += 1
            pending["next_at"] = now + backoff_seconds(pending["attempts"])
            self._save_locked()

    def mark_dead(self, mid: str, now: float, reason: str) -> None:
        with self._lock:
            self._data["pending"].pop(mid, None)
            self._data["dead"][mid] = {"ts": now, "reason": reason}
            self._save_locked()

    def _prune_locked(self, now: float) -> None:
        seen = self._data["seen"]
        self._data["seen"] = {mid: ts for mid, ts in seen.items() if now - ts < SEEN_TTL_SECONDS}
        pending = self._data["pending"]
        self._data["pending"] = {mid: e for mid, e in pending.items() if now - e.get("first_at", now) < SEEN_TTL_SECONDS}
        dead = self._data["dead"]
        self._data["dead"] = {mid: e for mid, e in dead.items() if now - e.get("ts", now) < SEEN_TTL_SECONDS}

    def _save_locked(self) -> None:
        tmp = self._path.with_suffix(".json.tmp")
        try:
            tmp.write_text(json.dumps(self._data, ensure_ascii=False))
            os.chmod(tmp, 0o600)
            os.replace(tmp, self._path)
        except OSError as err:
            self._log("state-save-fail " + type(err).__name__)


def deliver_once(url: str, payload: Dict[str, object], key: str, timeout: float) -> int:
    req = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode(),
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status
    except urllib.error.HTTPError as err:
        return err.code
    except (urllib.error.URLError, OSError, ValueError):
        return 0


def process_due(
    state: BridgeState,
    keystore: KeyStore,
    url: str,
    deliver: Callable[[str, Dict[str, object], str], int],
    now: float,
    log: Callable[[str], None],
) -> None:
    for mid, _entry in state.due_entries(now):
        entry = state.entry(mid)
        if entry is None:
            continue
        status = deliver(url, entry["payload"], keystore.get())
        outcome = classify_status(status)
        if outcome == "accept":
            state.mark_seen(mid, now)
            log("wake " + mid + " -> " + str(status))
        elif outcome == "retry":
            state.mark_retry(mid, now)
            log("retry-queued " + mid + " -> " + str(status))
        elif outcome == "auth":
            _handle_auth(state, keystore, url, deliver, mid, entry, status, now, log)
        else:
            state.mark_dead(mid, now, "http-" + str(status))
            log("dead " + mid + " -> " + str(status))


def _handle_auth(
    state: BridgeState,
    keystore: KeyStore,
    url: str,
    deliver: Callable[[str, Dict[str, object], str], int],
    mid: str,
    entry: Dict[str, object],
    status: int,
    now: float,
    log: Callable[[str], None],
) -> None:
    if not keystore.refresh():
        state.mark_dead(mid, now, "auth-key-unchanged")
        log("dead " + mid + " auth status=" + str(status))
        return
    retried = deliver(url, entry["payload"], keystore.get())
    if classify_status(retried) == "accept":
        state.mark_seen(mid, now)
        log("wake " + mid + " -> " + str(retried) + " after key rotation")
        return
    state.mark_dead(mid, now, "auth-after-rotation-" + str(retried))
    log("dead " + mid + " auth status=" + str(retried))
