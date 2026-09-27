#!/usr/bin/env python3
"""feishu_webhook_ingress.py behavior tests (unittest, stdlib only, Python 3.9)."""
from __future__ import annotations

import json
import stat
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import feishu_webhook_ingress as ingress

TEST_KEY = "test-key-123"
TEST_ENCRYPT_KEY = "test-encrypt-key"
TEST_TOKEN = "verification-token-a"
TEST_CHAT = "oc_test_chat"


class StubReceiver:
    def __init__(self) -> None:
        self.requests: List[Tuple[str, Optional[str], Dict[str, object]]] = []
        self.statuses: List[int] = []
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, fmt: str, *args: object) -> None:
                pass

            def do_POST(self) -> None:
                length = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}
                outer.requests.append((self.path, self.headers.get("Authorization"), body))
                status = outer.statuses.pop(0) if outer.statuses else 202
                payload = json.dumps({"ok": True}).encode()
                self.send_response(status)
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def stop(self) -> None:
        self.server.shutdown()


class IngressHarness:
    def __init__(self, tmp: Path, encrypt_key: str = TEST_ENCRYPT_KEY) -> None:
        self.stub = StubReceiver()
        self.logs: List[str] = []
        self.cfg = ingress.IngressConfig(
            host="127.0.0.1",
            port=0,
            chat_id=TEST_CHAT,
            forward_url="http://127.0.0.1:" + str(self.stub.port) + "/webhook/agent-x/routine-y",
            docker_cmd=("false",),
            key_file=tmp / "webhook.key",
            state_path=tmp / "state-webhook.json",
            token_file=tmp / "ingress-token",
            log=self.logs.append,
            encrypt_key=encrypt_key,
        )
        self.app = ingress.FeishuIngress(self.cfg)
        self.app.start()
        self.base = "http://127.0.0.1:" + str(self.app._httpd.server_address[1])

    def stop(self) -> None:
        self.app.stop()
        self.stub.stop()

    def pinned_token_of(self) -> str:
        return self.cfg.token_file.read_text().strip()

    def post(self, path: str, payload: object) -> Tuple[int, Dict[str, object]]:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(self.base + path, data=data, headers={"Content-Type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                return resp.status, json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as err:
            return err.code, json.loads(err.read().decode("utf-8"))

    def verify(self, token: str = TEST_TOKEN, challenge: str = "ch-1") -> Tuple[int, Dict[str, object]]:
        return self.post("/feishu", {"type": "url_verification", "challenge": challenge, "token": token})

    def p2p_event(self, mid: str, text: str = "hello", chat_id: str = TEST_CHAT, token: str = TEST_TOKEN) -> Dict[str, object]:
        return {
            "schema": "2.0",
            "header": {"event_id": "ev-" + mid, "event_type": "im.message.receive_v1", "token": token},
            "event": {
                "sender": {"sender_id": {"open_id": "ou_1"}, "sender_type": "user"},
                "message": {
                    "message_id": mid,
                    "chat_id": chat_id,
                    "chat_type": "p2p",
                    "message_type": "text",
                    "content": json.dumps({"text": text}, ensure_ascii=False),
                    "create_time": "1700000000000",
                },
            },
        }

    def wait_stub(self, count: int, timeout: float = 3.0) -> bool:
        deadline = time.time() + timeout
        while time.time() < deadline:
            if len(self.stub.requests) >= count:
                return True
            time.sleep(0.05)
        return False


class IngressTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp_dir = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp_dir.name)
        (self.tmp / "webhook.key").write_text(TEST_KEY)
        self.harness = IngressHarness(self.tmp)

    def tearDown(self) -> None:
        self.harness.stop()
        self._tmp_dir.cleanup()

    def test_health(self) -> None:
        with urllib.request.urlopen(self.harness.base + "/health", timeout=5) as resp:
            body = json.loads(resp.read().decode("utf-8"))
        self.assertEqual(resp.status, 200)
        self.assertTrue(body["ok"])

    def test_url_verification_echoes_and_pins(self) -> None:
        status, body = self.harness.verify(challenge="abc-123")
        self.assertEqual((status, body), (200, {"challenge": "abc-123"}))
        token_file = self.harness.cfg.token_file
        self.assertEqual(token_file.read_text().strip(), TEST_TOKEN)
        self.assertEqual(stat.S_IMODE(token_file.stat().st_mode), 0o600)
        self.assertEqual(self.harness.stub.requests, [])

    def test_encrypted_url_verification(self) -> None:
        inner = {"type": "url_verification", "challenge": "enc-9", "token": "enc-token"}
        encrypted = {"encrypt": ingress.feishu_encrypt(TEST_ENCRYPT_KEY, json.dumps(inner).encode("utf-8"))}
        status, body = self.harness.post("/feishu", encrypted)
        self.assertEqual((status, body), (200, {"challenge": "enc-9"}))
        self.assertEqual(self.harness.pinned_token_of(), "enc-token")

    def test_event_forwarded_with_bearer_and_text(self) -> None:
        self.harness.verify()
        status, body = self.harness.post("/feishu", self.harness.p2p_event("om_1", text="你好"))
        self.assertEqual((status, body), (200, {"ok": True}))
        self.assertTrue(self.harness.wait_stub(1))
        path, auth, payload = self.harness.stub.requests[0]
        self.assertEqual(path, "/webhook/agent-x/routine-y")
        self.assertEqual(auth, "Bearer " + TEST_KEY)
        self.assertEqual(payload["text"], "你好")
        self.assertEqual(payload["message_id"], "om_1")
        self.assertEqual(payload["source"], "feishu-webhook")

    def test_event_replay_dedup(self) -> None:
        self.harness.verify()
        self.harness.post("/feishu", self.harness.p2p_event("om_2"))
        self.assertTrue(self.harness.wait_stub(1))
        status, body = self.harness.post("/feishu", self.harness.p2p_event("om_2"))
        self.assertEqual((status, body), (200, {"ok": True, "dedup": True}))
        self.assertEqual(len(self.harness.stub.requests), 1)

    def test_group_chat_filtered(self) -> None:
        self.harness.verify()
        status, body = self.harness.post("/feishu", self.harness.p2p_event("om_3", chat_id="oc_group"))
        self.assertEqual((status, body), (200, {"ok": True, "filtered": True}))
        self.assertEqual(self.harness.stub.requests, [])

    def test_wrong_token_rejected_after_pin(self) -> None:
        self.harness.verify()
        status, _ = self.harness.post("/feishu", self.harness.p2p_event("om_4", token="wrong"))
        self.assertEqual(status, 403)
        self.assertEqual(self.harness.stub.requests, [])

    def test_non_text_content_forwarded_as_raw(self) -> None:
        self.harness.verify()
        raw_content = json.dumps({"image_key": "img_v2_x"}, separators=(",", ":"))
        event = self.harness.p2p_event("om_5")
        event["event"]["message"]["message_type"] = "image"
        event["event"]["message"]["content"] = raw_content
        status, _ = self.harness.post("/feishu", event)
        self.assertEqual(status, 200)
        self.assertTrue(self.harness.wait_stub(1))
        self.assertEqual(self.harness.stub.requests[0][2]["text"], raw_content)

    def test_oversize_body_rejected(self) -> None:
        self.harness.verify()
        status, body = self.harness.post("/feishu", {"pad": "x" * (ingress.MAX_BODY_BYTES + 10)})
        self.assertEqual(status, 413)

    def test_logs_do_not_leak_key_or_text(self) -> None:
        self.harness.verify()
        self.harness.post("/feishu", self.harness.p2p_event("om_6", text="secret-body"))
        self.assertTrue(self.harness.wait_stub(1))
        joined = "\n".join(self.harness.logs)
        self.assertNotIn(TEST_KEY, joined)
        self.assertNotIn("secret-body", joined)


if __name__ == "__main__":
    unittest.main()
