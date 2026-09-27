#!/usr/bin/env python3
"""delivery.py behavior tests (unittest, stdlib only, Python 3.9 compatible)."""
from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import delivery


class RecordingKeyStore(delivery.KeyStore):
    def __init__(self, initial: str, rotated: str = "") -> None:
        super().__init__(("true",), Path("/nonexistent"), lambda _msg: None)
        self._key = initial
        self._key_hash = "force-init"
        self._rotated = rotated

    def refresh(self) -> bool:
        if self._rotated and self._key != self._rotated:
            self._key = self._rotated
            return True
        return False


class BridgeTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.path = Path(self._tmp.name) / "state.json"
        self.logs: List[str] = []
        self.state = delivery.BridgeState(self.path, self.logs.append)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def enqueue(self, mid: str = "m1", payload: Optional[Dict[str, object]] = None) -> None:
        self.state.enqueue(mid, payload or {"message_id": mid, "content": "hi"}, 1000.0)

    def run_due(self, statuses: Tuple[int, ...], keystore: Optional[RecordingKeyStore] = None) -> None:
        store = keystore or RecordingKeyStore("k")
        queue = list(statuses)

        def fake_deliver(_url: str, _payload: Dict[str, object], _key: str) -> int:
            return queue.pop(0) if queue else 202

        now = 2000.0
        for _ in range(len(statuses)):
            delivery.process_due(self.state, store, "http://x", fake_deliver, now, self.logs.append)
            now += 61  # advance past the max backoff so the next attempt becomes due

    def test_status_classification(self) -> None:
        cases = {202: "accept", 200: "accept", 409: "retry", 429: "retry", 502: "retry", 503: "retry", 401: "auth", 404: "dead", 400: "dead", 413: "dead"}
        for status, expected in cases.items():
            self.assertEqual(delivery.classify_status(status), expected, "status " + str(status))

    def test_backoff_schedule(self) -> None:
        self.assertEqual([delivery.backoff_seconds(n) for n in (1, 2, 3, 4, 5, 9)], [5, 10, 30, 60, 60, 60])

    def test_accepted_moves_to_seen(self) -> None:
        self.enqueue()
        self.run_due((202,))
        self.assertIn("m1", self.state._data["seen"])
        self.assertNotIn("m1", self.state._data["pending"])

    def test_409_stays_pending_and_recovers(self) -> None:
        self.enqueue()
        self.run_due((409, 202))
        self.assertIn("m1", self.state._data["seen"])

    def test_401_with_rotation_recovers(self) -> None:
        self.enqueue()
        self.run_due((401,), keystore=RecordingKeyStore("old", rotated="new"))
        self.assertIn("m1", self.state._data["seen"])

    def test_401_without_rotation_goes_dead(self) -> None:
        self.enqueue()
        self.run_due((401,), keystore=RecordingKeyStore("same"))
        self.assertEqual(self.state._data["dead"]["m1"]["reason"], "auth-key-unchanged")

    def test_401_after_rotation_still_failing_goes_dead(self) -> None:
        self.enqueue()
        store = RecordingKeyStore("old", rotated="new")

        def always_401(_url: str, _payload: Dict[str, object], _key: str) -> int:
            return 401

        delivery.process_due(self.state, store, "http://x", always_401, 2000.0, self.logs.append)
        self.assertEqual(self.state._data["dead"]["m1"]["reason"], "auth-after-rotation-401")

    def test_404_goes_dead(self) -> None:
        self.enqueue()
        self.run_due((404,))
        self.assertEqual(self.state._data["dead"]["m1"]["reason"], "http-404")

    def test_network_error_stays_pending(self) -> None:
        self.enqueue()
        self.run_due((0,))
        self.assertIn("m1", self.state._data["pending"])
        self.assertEqual(self.state._data["pending"]["m1"]["attempts"], 1)

    def test_legacy_state_migration(self) -> None:
        self.path.write_text(json.dumps({"replied": {"old1": 1.0}, "seen": {"old2": 2.0}}))
        self.state.load()
        self.assertIn("old1", self.state._data["seen"])
        self.assertIn("old2", self.state._data["seen"])
        self.assertEqual(self.state._data["version"], 2)

    def test_atomic_persistence_and_permissions(self) -> None:
        self.enqueue()
        self.assertEqual(oct(os.stat(self.path).st_mode & 0o777), "0o600")
        self.assertFalse(self.path.with_suffix(".json.tmp").exists())
        on_disk = json.loads(self.path.read_text())
        self.assertEqual(on_disk["version"], 2)

    def test_logs_never_contain_key_or_body(self) -> None:
        self.enqueue(mid="secret-mid", payload={"message_id": "secret-mid", "content": "private-text"})
        self.run_due((202,), keystore=RecordingKeyStore("super-secret-key"))
        joined = "\n".join(self.logs)
        self.assertNotIn("super-secret-key", joined)
        self.assertNotIn("private-text", joined)


if __name__ == "__main__":
    unittest.main()
