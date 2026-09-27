#!/usr/bin/env python3
"""Grok Node feishu bridge daemon: lark-cli long connection -> local webhook delivery.

Wires delivery.py: consume thread parses events into pending, worker thread retries
with backoff, refresher thread hot-reloads the key, flock keeps a single consumer.
"""
from __future__ import annotations

import fcntl
import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Callable, Dict

sys.path.insert(0, str(Path(__file__).resolve().parent))
from delivery import BridgeState, KeyStore, deliver_once, process_due  # noqa: E402

HERE = Path(__file__).resolve().parent
STATE = HERE / "state.json"
LOG = HERE / "bridge.log"
LOCK = HERE / "bridge.lock"

AGENT_ID = os.environ.get("FEISHU_NODE_AGENT", "70e22ee1-4b23-4860-a598-9e39f47ddc19")
ROUTINE = os.environ.get("FEISHU_NODE_ROUTINE", "feishu-p2p")
CHAT_ID = os.environ.get("FEISHU_NODE_CHAT", "oc_a7e04713b2f5e6a8991b639d309f2612")
PORT = int(os.environ.get("FEISHU_NODE_PORT", "17901"))
WEBHOOK_URL = "http://127.0.0.1:" + str(PORT) + "/webhook/" + AGENT_ID + "/" + ROUTINE
LARK_CLI = os.environ.get(
    "FEISHU_NODE_LARKCLI",
    str(Path.home() / ".workbuddy/binaries/node/cli-connector-packages/bin/lark-cli"),
)
KEY_FILE = Path(os.environ.get("FEISHU_NODE_KEY_FILE", str(HERE / "webhook.key")))
CANONICAL_KEY_PATH = os.environ.get(
    "FEISHU_NODE_CANONICAL_KEY",
    "/home/box/sand-data/agents/70e22ee1-4b23-4860-a598-9e39f47ddc19/automations/feishu-p2p/webhook.json",
)
CONTAINER = os.environ.get("FEISHU_NODE_CONTAINER", "grok-node-local-vm")
DELIVER_TIMEOUT = float(os.environ.get("FEISHU_NODE_TIMEOUT", "60"))
KEY_REFRESH_SECONDS = float(os.environ.get("FEISHU_NODE_KEY_REFRESH", "60"))

JQ = 'select(.chat_type=="p2p" and .chat_id=="' + CHAT_ID + '" and .sender_type=="user")'


def ensure_launchd_path() -> None:
    """launchd gives a minimal PATH without /usr/local/bin (docker, node); add the standard dirs."""
    extra = ("/usr/local/bin", "/opt/homebrew/bin")
    current = os.environ.get("PATH", "")
    os.environ["PATH"] = ":".join([d for d in extra if d not in current.split(":")] + [current])


def log(message: str) -> None:
    line = time.strftime("%m-%d %H:%M:%S") + " " + message + "\n"
    try:
        with open(LOG, "a") as handle:
            handle.write(line)
    except OSError:
        pass
    print(line, end="", flush=True)


_LOCK_HANDLE = None


def acquire_singleton() -> bool:
    """Hold the lock file open for the process lifetime; closing the handle would release the flock."""
    global _LOCK_HANDLE
    _LOCK_HANDLE = open(LOCK, "a")
    try:
        fcntl.flock(_LOCK_HANDLE.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        return True
    except OSError:
        log("already-running exiting")
        _LOCK_HANDLE.close()
        _LOCK_HANDLE = None
        return False


def start_lark(log_fn: Callable[[str], None]) -> subprocess.Popen:
    cmd = [LARK_CLI, "event", "consume", "im.message.receive_v1", "--as", "bot", "--jq", JQ]
    tail = subprocess.Popen(["tail", "-f", "/dev/null"], stdout=subprocess.PIPE)
    assert tail.stdout is not None
    proc = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, stdin=tail.stdout, text=True, bufsize=1
    )
    assert proc.stdout is not None and proc.stderr is not None

    def drain_stderr() -> None:
        try:
            for err_line in proc.stderr:
                if err_line.strip():
                    log_fn("consume-stderr " + err_line.rstrip()[:300])
        except (OSError, ValueError):
            log_fn("stderr-drain-end")

    threading.Thread(target=drain_stderr, daemon=True).start()
    return proc


def event_wanted(event: Dict[str, object]) -> bool:
    text = str(event.get("content", ""))
    if "selftest" in text.lower() or event.get("selftest") is True:
        return False
    return event.get("chat_id") == CHAT_ID


def main() -> int:
    ensure_launchd_path()
    if not acquire_singleton():
        return 0
    keystore = KeyStore(("docker", "exec", CONTAINER, "cat", CANONICAL_KEY_PATH), KEY_FILE, log)
    if not keystore.load_initial():
        log("FATAL no webhook key from canonical or fallback; refusing to start")
        return 2
    state = BridgeState(STATE, log)
    state.load()
    log("start agent=" + AGENT_ID + " routine=" + ROUTINE + " chat=" + CHAT_ID + " port=" + str(PORT))

    wake = threading.Condition()

    def worker() -> None:
        def deliver(url: str, payload: Dict[str, object], key: str) -> int:
            return deliver_once(url, payload, key, DELIVER_TIMEOUT)

        while True:
            with wake:
                if not state.due_entries(time.time()):
                    wake.wait(timeout=5)
            process_due(state, keystore, WEBHOOK_URL, deliver, time.time(), log)
            time.sleep(0.2)

    def refresher() -> None:
        while True:
            time.sleep(KEY_REFRESH_SECONDS)
            keystore.refresh()

    threading.Thread(target=worker, daemon=True).start()
    threading.Thread(target=refresher, daemon=True).start()

    proc = start_lark(log)
    for line in proc.stdout:
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except ValueError:
            log("bad-line " + line[:200])
            continue
        if not isinstance(event, dict) or not event_wanted(event):
            if isinstance(event, dict) and "selftest" in str(event.get("content", "")).lower():
                log("selftest-skip " + str(event.get("message_id", "")))
            continue
        mid = str(event.get("message_id") or event.get("id") or "")
        if not mid or state.is_known(mid):
            if mid:
                log("dedup " + mid)
            continue
        state.enqueue(mid, event, time.time())
        with wake:
            wake.notify_all()
    log("consume-exit code=" + str(proc.wait()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
