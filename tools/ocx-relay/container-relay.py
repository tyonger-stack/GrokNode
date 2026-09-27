# Container-side relay: 127.0.0.1:10100 -> MAC:11010 (Mac L7 forwarder).
# Adds X-Relay-Token, preserves Host, streams bodies (SSE-safe, no buffering).
import os, socket, threading, sys

LISTEN_HOST = "127.0.0.1"
LISTEN_PORT = int(os.environ.get("RELAY_LISTEN_PORT", "10100"))
UPSTREAM_HOST = os.environ.get("RELAY_UPSTREAM_HOST", "")
UPSTREAM_PORT = int(os.environ.get("RELAY_UPSTREAM_PORT", "11010"))
TOKEN = os.environ.get("RELAY_TOKEN", "")
if not UPSTREAM_HOST or not TOKEN:
    print("RELAY_UPSTREAM_HOST and RELAY_TOKEN required", flush=True)
    sys.exit(1)

# 2026-09-26: was 120.0 and killed every inference that queued >120s or whose
# first upstream byte was slow (muse-spark commonly runs 100-160s/step). The
# Mac forwarder now bounds time-to-terminal itself (queue 75s, idle 180s,
# 429 retries), so this only needs to stay above the forwarder's worst case.
IDLE_TIMEOUT = 480.0

def read_headers(f):
    headers = []
    length = 0
    chunked = False
    while True:
        line = f.readline(65536)
        if not line or line in (b"\r\n", b"\n"):
            break
        headers.append(line)
        low = line.lower()
        if low.startswith(b"content-length:"):
            try: length = int(low.split(b":", 1)[1].strip())
            except: pass
        elif low.startswith(b"transfer-encoding:") and b"chunked" in low:
            chunked = True
    return headers, length, chunked

def read_chunked(f):
    chunks = []
    while True:
        line = f.readline(256)
        if not line: break
        chunks.append(line)
        try: size = int(line.strip().split(b";")[0], 16)
        except: break
        if size == 0:
            chunks.append(f.readline(256))
            break
        data = f.read(size)
        chunks.append(data)
        chunks.append(f.readline(256))
    return b"".join(chunks)

def read_exactly(f, n):
    parts = []
    while n > 0:
        piece = f.read(min(65536, n))
        if not piece:
            break
        parts.append(piece)
        n -= len(piece)
    return b"".join(parts)

def forward_response_body(client, uf, length, chunked):
    if chunked:
        while True:
            sizeline = uf.readline(256)
            if not sizeline:
                return
            client.sendall(sizeline)
            try:
                size = int(sizeline.strip().split(b";")[0], 16)
            except Exception:
                return
            if size == 0:
                while True:
                    line = uf.readline(65536)
                    if not line:
                        return
                    client.sendall(line)
                    if line in (b"\r\n", b"\n"):
                        return
            body = read_exactly(uf, size + 2)
            if body:
                client.sendall(body)
            if len(body) < size + 2:
                return
    elif length > 0:
        body = read_exactly(uf, length)
        if body:
            client.sendall(body)
    else:
        while True:
            piece = uf.read(65536)
            if not piece:
                return
            client.sendall(piece)

def handle(client):
    try:
        cf = client.makefile("rwb")
        reqline = cf.readline(65536)
        if not reqline: return
        headers, length, chunked = read_headers(cf)
        body = read_chunked(cf) if chunked else (cf.read(length) if length > 0 else b"")
        up = socket.create_connection((UPSTREAM_HOST, UPSTREAM_PORT), timeout=20)
        up.settimeout(IDLE_TIMEOUT)
        uf = up.makefile("rwb")
        uf.write(reqline)
        seen_token = False
        for h in headers:
            if h.lower().startswith(b"x-relay-token:"): continue
            uf.write(h)
        uf.write(b"X-Relay-Token: " + TOKEN.encode() + b"\r\n")
        uf.write(b"\r\n")
        if body: uf.write(body)
        uf.flush()
        status = uf.readline(65536)
        if not status: return
        client.sendall(status)
        rheaders, rlen, rchunked = read_headers(uf)
        for h in rheaders: client.sendall(h)
        client.sendall(b"\r\n")
        forward_response_body(client, uf, rlen, rchunked)
    except Exception as e:
        try: print("relay error: %s" % e, flush=True)
        except: pass
    finally:
        try: client.close()
        except: pass

srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind((LISTEN_HOST, LISTEN_PORT))
srv.listen(64)
with open("/tmp/ocx-relay.pid", "w") as f:
    f.write(str(os.getpid()))
with open("/tmp/ocx-relay.code-md5", "w") as f:
    import hashlib
    f.write(hashlib.md5(open(__file__, "rb").read()).hexdigest())
print("container relay %s:%d -> %s:%d" % (LISTEN_HOST, LISTEN_PORT, UPSTREAM_HOST, UPSTREAM_PORT), flush=True)
while True:
    c, _ = srv.accept()
    threading.Thread(target=handle, args=(c,), daemon=True).start()
