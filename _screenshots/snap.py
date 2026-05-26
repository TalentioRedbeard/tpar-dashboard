#!/usr/bin/env python3
"""One-off helper: navigate + screenshot via mcp-tpar browser bridge."""
import json
import os
import sys
import time
import base64
import urllib.request

MCP_URL = "https://bwpoqsfrygyopwxmegax.supabase.co/functions/v1/mcp-tpar"
MCP_TOKEN = "d16fbd26ad4030d87ca6e403dfdd2255cb734585224a5467d893597765dd66ce"


def call(name, args):
    body = json.dumps({"jsonrpc": "2.0", "method": "tools/call", "params": {"name": name, "arguments": args}, "id": 1}).encode()
    req = urllib.request.Request(MCP_URL, data=body, headers={"Authorization": f"Bearer {MCP_TOKEN}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def snap(path, label):
    print(f"-> {path}")
    call("browser_navigate", {"url": f"https://tpar-dashboard.vercel.app{path}"})
    time.sleep(4)
    out = call("browser_screenshot", {"full_page": False})
    content = out.get("result", {}).get("content", [])
    for c in content:
        if c.get("type") == "image":
            img = base64.b64decode(c["data"])
            target = os.path.join(os.path.dirname(__file__), f"{label}.png")
            with open(target, "wb") as f:
                f.write(img)
            print(f"   saved {target} ({len(img)} bytes)")
            return target
        elif c.get("type") == "text":
            txt = c["text"]
            if txt.startswith("{") and "data" in txt:
                try:
                    inner = json.loads(txt)
                    if inner.get("data"):
                        img = base64.b64decode(inner["data"])
                        target = os.path.join(os.path.dirname(__file__), f"{label}.png")
                        with open(target, "wb") as f:
                            f.write(img)
                        print(f"   saved {target} ({len(img)} bytes)")
                        return target
                except Exception:
                    pass
            print(f"   text response (no image): {txt[:300]}")
    print(f"   no image extracted; raw response: {json.dumps(out)[:400]}")
    return None


if __name__ == "__main__":
    for path, label in [
        ("/me", "me-page"),
        ("/find", "find-page"),
        ("/receipt", "receipt-page"),
    ]:
        try:
            snap(path, label)
        except Exception as e:
            print(f"   ERROR: {e}")
