#!/usr/bin/env python3
"""Grok Node feishu webhook ingress: Feishu event-subscription HTTP push -> local wake.

Public entry designed to sit behind Tailscale Funnel (https://<host>.ts.net/feishu
-> 127.0.0.1:17902). Answers url_verification challenges, decrypts encrypted
bodies (Feishu AES-256-CBC via CommonCrypto), pins the app verification token
on first sight (TOFU), filters p2p events with the same rules as bridge.py,
then enqueues into the delivery.py state machine that wakes the Grok Node
webhook listener on 127.0.0.1:17901.

stdlib only, Python 3.9 compatible, macOS (CommonCrypto only needed for
encrypted pushes). Logs never contain the webhook key or message bodies.
"""
from __future__ import annotations

import base64
import ctypes
import hashlib
import json
import os
import signal
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Callable, Dict, Optional, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent))
from delivery import BridgeState, KeyStore, deliver_once, process_due  # noqa: E402

HERE = Path(__file__).resolve().parent
MAX_BODY_BYTES = 64 * 1024
MAX_DISCARD_BYTES = 8 * 1024 * 1024

DEFAULT_STATE = HERE / "state-webhook.json"
DEFAULT_TOKEN_FILE = HERE / "ingress-token"
DEFAULT_KEY_FILE = HERE / "webhook.key"
DEFAULT_LOG = HERE / "ingress.log"

_KCC_ENCRYPT = 0
_KCC_DECRYPT = 1
_KCC_AES = 0
_KCC_PKCS7 = 0x1
_KCC_SUCCESS = 0
_CRYPTO = None


def _commoncrypto() -> ctypes.CDLL:
    global _CRYPTO
    if _CRYPTO is None:
        lib = ctypes.CDLL("/usr/lib/libSystem.B.dylib")
        lib.CCCrypt.restype = ctypes.c_int
        lib.CCCrypt.argtypes = [
            ctypes.c_uint32, ctypes.c_uint32, ctypes.c_uint32,
            ctypes.c_char_p, ctypes.c_size_t, ctypes.c_char_p,
            ctypes.c_char_p, ctypes.c_size_t,
            ctypes.c_char_p, ctypes.c_size_t, ctypes.POINTER(ctypes.c_size_t),
        ]
        _CRYPTO = lib
    return _CRYPTO


def _cc_crypt(op: int, key: bytes, iv: bytes, data: bytes) -> bytes:
    lib = _commoncrypto()
    out = ctypes.create_string_buffer(len(data) + 32)
    moved = ctypes.c_size_t(0)
    status = lib.CCCrypt(
        op, _KCC_AES, _KCC_PKCS7,
        key, len(key), iv,
        data, len(data),
        out, len(out), ctypes.byref(moved),
    )
    if status != _KCC_SUCCESS:
        raise ValueError("CCCrypt status " + str(status))
    return out.raw[: moved.value]


def feishu_aes_key(encrypt_key: str) -> bytes:
    return hashlib.sha256(encrypt_key.encode()).digest()


def feishu_decrypt(encrypt_key: str, ciphertext_b64: str) -> bytes:
    key = feishu_aes_key(encrypt_key)
    return _cc_crypt(_KCC_DECRYPT, key, key[:16], base64.b64decode(ciphertext_b64))


def feishu_encrypt(encrypt_key: str, plaintext: bytes) -> str:
    key = feishu_aes_key(encrypt_key)
    return base64.b64encode(_cc_crypt(_KCC_ENCRYPT, key, key[:16], plaintext)).decode()


def extract_text(content: object) -> str:
    """Feishu message.content is a JSON string like {"text":"hi"}; return the readable text."""
    if isinstance(content, dict):
        text = content.get("text")
        return text if isinstance(text, str) else json.dumps(content, ensure_ascii=False)
    if not isinstance(content, str):
        return "" if content is None else str(content)
    try:
        parsed = json.loads(content)
    except ValueError:
        return content
    if isinstance(parsed, dict) and isinstance(parsed.get("text"), str):
        return parsed["text"]
    return content


class IngressConfig:
    def __init__(
        self,
        host: str,
        port: int,
        chat_id: str,
        forward_url: str,
        docker_cmd: Tuple[str, ...],
        key_file: Path,
        state_path: Path,
        token_file: Path,
        log: Callable[[str], None],
        encrypt_key: str = "",
        pinned_token_env: str = "",
        deliver_timeout: float = 10.0,
        key_refresh_seconds: float = 60.0,
    ) -> None:
        self.host = host
        self.port = port
        self.chat_id = chat_id
        self.forward_url = forward_url
        self.docker_cmd = docker_cmd
        self.key_file = key_file
        self.state_path = state_path
        self.token_file = token_file
        self.log = log
        self.encrypt_key = encrypt_key
        self.pinned_token_env = pinned_token_env
        self.deliver_timeout = deliver_timeout
        self.key_refresh_seconds = key_refresh_seconds


class FeishuIngress:
    def __init__(self, cfg: IngressConfig) -> None:
        self.cfg = cfg
        self.keystore = KeyStore(cfg.docker_cmd, cfg.key_file, cfg.log)
        self.state = BridgeState(cfg.state_path, cfg.log)
        self._wake = threading.Condition()
        self._stop = threading.Event()
        self._httpd: Optional[ThreadingHTTPServer] = None

    def start(self) -> None:
        if not self.keystore.load_initial():
            raise RuntimeError("no webhook key from canonical or fallback; refusing to start")
        self.state.load()
        server = ThreadingHTTPServer((self.cfg.host, self.cfg.port), make_handler(self))
        self._httpd = server
        threading.Thread(target=server.serve_forever, daemon=True).start()
        threading.Thread(target=self._worker, daemon=True).start()
        threading.Thread(target=self._refresher, daemon=True).start()

    def stop(self) -> None:
        self._stop.set()
        with self._wake:
            self._wake.notify_all()
        if self._httpd is not None:
            self._httpd.shutdown()

    def _worker(self) -> None:
        def deliver(url: str, payload: Dict[str, object], key: str) -> int:
            return deliver_once(url, payload, key, self.cfg.deliver_timeout)

        while not self._stop.is_set():
            with self._wake:
                if not self.state.due_entries(time.time()):
                    self._wake.wait(timeout=5)
            if self._stop.is_set():
                return
            process_due(self.state, self.keystore, self.cfg.forward_url, deliver, time.time(), self.cfg.log)

    def _refresher(self) -> None:
        while not self._stop.wait(self.cfg.key_refresh_seconds):
            self.keystore.refresh()

    def status_snapshot(self) -> Dict[str, object]:
        with self.state._lock:
            counts = {name: len(table) for name, table in self.state._data.items() if isinstance(table, dict)}
        return {
            "ok": True,
            "service": "grok-node-feishu-ingress",
            "target": self.cfg.forward_url,
            "token_pinned": bool(self.pinned_token()),
            "state": counts,
        }

    def pinned_token(self) -> str:
        if self.cfg.pinned_token_env:
            return self.cfg.pinned_token_env
        try:
            return self.cfg.token_file.read_text().strip()
        except OSError:
            return ""

    def _pin_token(self, token: str) -> None:
        if not token or self.cfg.pinned_token_env or self.pinned_token() == token:
            return
        tmp = self.cfg.token_file.with_suffix(".tmp")
        tmp.write_text(token + "\n")
        os.chmod(tmp, 0o600)
        os.replace(tmp, self.cfg.token_file)
        self.cfg.log("token-saved")

    def handle_feishu(self, raw: bytes) -> Tuple[int, Dict[str, object]]:
        if len(raw) > MAX_BODY_BYTES:
            return 413, {"error": "body too large"}
        try:
            body = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            return 400, {"error": "bad json"}
        if not isinstance(body, dict):
            return 400, {"error": "bad json"}
        if "encrypt" in body:
            if not self.cfg.encrypt_key:
                self.cfg.log("decrypt-fail no-encrypt-key")
                return 400, {"error": "encrypted body but no encrypt key configured"}
            try:
                plain = feishu_decrypt(self.cfg.encrypt_key, str(body.get("encrypt") or ""))
                body = json.loads(plain.decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                self.cfg.log("decrypt-fail bad-ciphertext")
                return 400, {"error": "decrypt failed"}
            if not isinstance(body, dict):
                return 400, {"error": "decrypted bad json"}
        header = body.get("header") if isinstance(body.get("header"), dict) else {}
        token = str(body.get("token") or header.get("token") or "")
        body_type = str(body.get("type") or header.get("event_type") or "")
        if body_type == "url_verification":
            challenge = body.get("challenge")
            if not challenge:
                return 400, {"error": "missing challenge"}
            self._pin_token(token)
            self.cfg.log("url-verified challenge-len=" + str(len(str(challenge))))
            return 200, {"challenge": challenge}
        pin = self.pinned_token()
        if pin:
            if not token or token != pin:
                self.cfg.log("token-reject")
                return 403, {"error": "token mismatch"}
        elif token:
            self._pin_token(token)
        else:
            self.cfg.log("event-without-token")
            return 403, {"error": "missing token"}
        return self._dispatch(body)

    def _dispatch(self, body: Dict[str, object]) -> Tuple[int, Dict[str, object]]:
        header = body.get("header") if isinstance(body.get("header"), dict) else {}
        event_type = str(header.get("event_type") or body.get("event_type") or "")
        if event_type != "im.message.receive_v1":
            self.cfg.log("ignored event_type=" + (event_type or "unknown"))
            return 200, {"ok": True, "ignored": True}
        event = body.get("event") if isinstance(body.get("event"), dict) else {}
        message = event.get("message") if isinstance(event.get("message"), dict) else {}
        sender = event.get("sender") if isinstance(event.get("sender"), dict) else {}
        chat_id = str(message.get("chat_id") or "")
        chat_type = str(message.get("chat_type") or "")
        sender_type = str(sender.get("sender_type") or "")
        if chat_type != "p2p" or chat_id != self.cfg.chat_id or sender_type != "user":
            self.cfg.log("filtered chat_type=" + (chat_type or "?"))
            return 200, {"ok": True, "filtered": True}
        mid = str(message.get("message_id") or "")
        if not mid:
            self.cfg.log("filtered no-message-id")
            return 200, {"ok": True, "ignored": True}
        if self.state.is_known(mid):
            self.cfg.log("dedup " + mid)
            return 200, {"ok": True, "dedup": True}
        text = extract_text(message.get("content"))
        sender_ids = sender.get("sender_id") if isinstance(sender.get("sender_id"), dict) else {}
        payload = {
            "message_id": mid,
            "chat_id": chat_id,
            "chat_type": chat_type,
            "sender_type": sender_type,
            "sender_id": str(sender_ids.get("open_id") or ""),
            "message_type": str(message.get("message_type") or ""),
            "content": text,
            "text": text,
            "create_time": message.get("create_time"),
            "source": "feishu-webhook",
        }
        self.state.enqueue(mid, payload, time.time())
        with self._wake:
            self._wake.notify_all()
        self.cfg.log("queued " + mid)
        return 200, {"ok": True}


def make_handler(ingress: FeishuIngress) -> type:
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt: str, *args: object) -> None:
            pass

        def _respond(self, code: int, body: bytes, extra: Optional[Dict[str, str]] = None) -> None:
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Connection", "close")
            for name, value in (extra or {}).items():
                self.send_header(name, value)
            self.end_headers()
            self.close_connection = True
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def do_GET(self) -> None:
            path = self.path.split("?")[0]
            if path == "/health":
                self._respond(200, json.dumps({"ok": True, "service": "grok-node-feishu-ingress"}).encode(),
                              {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})
            elif path == "/":
                self._respond(200, json.dumps(ingress.status_snapshot(), ensure_ascii=False).encode())
            else:
                self._respond(404, b'{"error":"not found"}')

        def do_POST(self) -> None:
            path = self.path.split("?")[0]
            if path.rstrip("/") != "/feishu":
                self._read_and_discard_body()
                self._respond(404, b'{"error":"not found"}')
                return
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                length = 0
            if length <= 0:
                self._respond(411, b'{"error":"length required"}')
                return
            if length > MAX_BODY_BYTES:
                self._read_and_discard_body(length)
                ingress.cfg.log("body-too-large len=" + str(length))
                self._respond(413, b'{"error":"body too large"}')
                return
            raw = self.rfile.read(length)
            status, obj = ingress.handle_feishu(raw)
            self._respond(status, json.dumps(obj).encode())

        def _read_and_discard_body(self, limit: int = MAX_DISCARD_BYTES) -> None:
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                return
            remaining = min(length, limit)
            while remaining > 0:
                chunk = self.rfile.read(min(remaining, 64 * 1024))
                if not chunk:
                    break
                remaining -= len(chunk)

    return Handler


def build_from_env() -> FeishuIngress:
    ensure_launchd_path()
    agent = os.environ.get("FEISHU_NODE_AGENT", "70e22ee1-4b23-4860-a598-9e39f47ddc19")
    routine = os.environ.get("FEISHU_NODE_ROUTINE", "feishu-p2p")
    container = os.environ.get("FEISHU_NODE_CONTAINER", "grok-node-local-vm")
    canonical = os.environ.get(
        "FEISHU_NODE_CANONICAL_KEY",
        "/home/box/sand-data/agents/" + agent + "/automations/" + routine + "/webhook.json",
    )
    port = int(os.environ.get("FEISHU_NODE_PORT", "17901"))
    cfg = IngressConfig(
        host=os.environ.get("FEISHU_INGRESS_HOST", "127.0.0.1"),
        port=int(os.environ.get("FEISHU_INGRESS_PORT", "17902")),
        chat_id=os.environ.get("FEISHU_NODE_CHAT", "oc_a7e04713b2f5e6a8991b639d309f2612"),
        forward_url="http://127.0.0.1:" + str(port) + "/webhook/" + agent + "/" + routine,
        docker_cmd=("docker", "exec", container, "cat", canonical),
        key_file=Path(os.environ.get("FEISHU_NODE_KEY_FILE", str(DEFAULT_KEY_FILE))),
        state_path=Path(os.environ.get("FEISHU_INGRESS_STATE", str(DEFAULT_STATE))),
        token_file=Path(os.environ.get("FEISHU_INGRESS_TOKEN_FILE", str(DEFAULT_TOKEN_FILE))),
        log=_make_logger(),
        encrypt_key=os.environ.get("FEISHU_ENCRYPT_KEY", ""),
        pinned_token_env=os.environ.get("FEISHU_VERIFICATION_TOKEN", ""),
        deliver_timeout=float(os.environ.get("FEISHU_NODE_TIMEOUT", "10")),
        key_refresh_seconds=float(os.environ.get("FEISHU_NODE_KEY_REFRESH", "60")),
    )
    return FeishuIngress(cfg)


def ensure_launchd_path() -> None:
    """launchd gives a minimal PATH without /usr/local/bin (docker); add the standard dirs."""
    extra = ("/usr/local/bin", "/opt/homebrew/bin")
    current = os.environ.get("PATH", "")
    os.environ["PATH"] = ":".join([d for d in extra if d not in current.split(":")] + [current])


def _make_logger() -> Callable[[str], None]:
    log_path = Path(os.environ.get("FEISHU_INGRESS_LOG", str(DEFAULT_LOG)))

    def log(message: str) -> None:
        line = time.strftime("%m-%d %H:%M:%S") + " " + message + "\n"
        try:
            with open(log_path, "a") as handle:
                handle.write(line)
        except OSError:
            pass
        print(line, end="", flush=True)

    return log


def main() -> int:
    ingress = build_from_env()

    def _terminate(_sig: int, _frame: object) -> None:
        ingress.stop()

    signal.signal(signal.SIGTERM, _terminate)
    signal.signal(signal.SIGINT, _terminate)
    try:
        ingress.start()
    except RuntimeError as err:
        ingress.cfg.log("FATAL " + str(err))
        return 2
    ingress.cfg.log(
        "ingress listening " + ingress.cfg.host + ":" + str(ingress.cfg.port)
        + " -> " + ingress.cfg.forward_url
    )
    while not ingress._stop.wait(3600):
        pass
    ingress.cfg.log("ingress stopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
