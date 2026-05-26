"""Re-auth the browser MCP via magic-link, then snap /me, /find, /receipt."""
import json
import os
import time
import base64
import urllib.request

MCP_URL = "https://bwpoqsfrygyopwxmegax.supabase.co/functions/v1/mcp-tpar"
MCP_TOKEN = "d16fbd26ad4030d87ca6e403dfdd2255cb734585224a5467d893597765dd66ce"
SERVICE_JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ3cG9xc2ZyeWd5b3B3eG1lZ2F4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzAzOTI1NywiZXhwIjoyMDgyMzk5MjU3fQ.z6ybALfzJOWA8x8bQOnDfx79xgCXjHSf_SSvyt_gn0s"


def mcp_call(name, args, timeout=60):
    body = json.dumps({"jsonrpc": "2.0", "method": "tools/call", "params": {"name": name, "arguments": args}, "id": 1}).encode()
    req = urllib.request.Request(MCP_URL, data=body, headers={"Authorization": f"Bearer {MCP_TOKEN}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def generate_magic_link():
    body = json.dumps({"type": "magiclink", "email": "ddunlop@tulsapar.com"}).encode()
    req = urllib.request.Request(
        "https://bwpoqsfrygyopwxmegax.supabase.co/auth/v1/admin/generate_link",
        data=body,
        headers={
            "Authorization": f"Bearer {SERVICE_JWT}",
            "apikey": SERVICE_JWT,
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.loads(r.read())
    return d["action_link"]


def auth_browser():
    link = generate_magic_link()
    print(f"   magic link generated")
    # Navigate browser to verify URL — will land on /login#access_token=...
    mcp_call("browser_navigate", {"url": link})
    time.sleep(2)
    # Get current URL to grab the fragment
    out = mcp_call("browser_current_url", {})
    url = json.loads(out["result"]["content"][0]["text"])["url"]
    idx = url.find("#")
    if idx < 0:
        raise RuntimeError(f"no fragment in landed URL: {url[:100]}")
    fragment = url[idx + 1:]
    # Navigate to implicit handler with fragment
    impl_url = f"https://tpar-dashboard.vercel.app/auth/callback/implicit?next=/me#{fragment}"
    mcp_call("browser_navigate", {"url": impl_url})
    time.sleep(5)
    # Verify
    out = mcp_call("browser_current_url", {})
    final = json.loads(out["result"]["content"][0]["text"])
    print(f"   landed at: {final['url'][:80]}")
    print(f"   title: {final['title']}")
    return "login" not in final["url"]


def snap(path, label):
    print(f"-> {path}")
    mcp_call("browser_navigate", {"url": f"https://tpar-dashboard.vercel.app{path}"})
    time.sleep(4)
    out = mcp_call("browser_screenshot", {"full_page": False})
    for c in out.get("result", {}).get("content", []):
        if c.get("type") == "image":
            img = base64.b64decode(c["data"])
            target = os.path.join(os.path.dirname(__file__), f"{label}.png")
            with open(target, "wb") as f:
                f.write(img)
            print(f"   saved {target} ({len(img)} bytes)")
            return target
        elif c.get("type") == "text":
            txt = c["text"]
            print(f"   text response: {txt[:200]}")
    print(f"   no image extracted")
    return None


if __name__ == "__main__":
    print("Re-authing browser MCP...")
    if not auth_browser():
        print("AUTH FAILED")
        exit(1)
    print("Auth confirmed.")
    for path, label in [
        ("/me", "me-page"),
        ("/find", "find-page"),
        ("/receipt", "receipt-page"),
    ]:
        try:
            snap(path, label)
        except Exception as e:
            print(f"   ERROR: {e}")
