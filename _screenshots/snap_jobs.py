"""Re-auth if needed, then snap /jobs."""
import json, os, time, base64, urllib.request

MCP_URL = "https://bwpoqsfrygyopwxmegax.supabase.co/functions/v1/mcp-tpar"
MCP_TOKEN = "d16fbd26ad4030d87ca6e403dfdd2255cb734585224a5467d893597765dd66ce"
SERVICE_JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ3cG9xc2ZyeWd5b3B3eG1lZ2F4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzAzOTI1NywiZXhwIjoyMDgyMzk5MjU3fQ.z6ybALfzJOWA8x8bQOnDfx79xgCXjHSf_SSvyt_gn0s"


def call(name, args, timeout=60):
    body = json.dumps({"jsonrpc": "2.0", "method": "tools/call", "params": {"name": name, "arguments": args}, "id": 1}).encode()
    req = urllib.request.Request(MCP_URL, data=body, headers={"Authorization": f"Bearer {MCP_TOKEN}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def gen_link():
    body = json.dumps({"type": "magiclink", "email": "ddunlop@tulsapar.com"}).encode()
    req = urllib.request.Request(
        "https://bwpoqsfrygyopwxmegax.supabase.co/auth/v1/admin/generate_link",
        data=body, headers={"Authorization": f"Bearer {SERVICE_JWT}", "apikey": SERVICE_JWT, "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())["action_link"]


# Try /jobs; if it lands on login, re-auth then retry
def need_reauth():
    call("browser_navigate", {"url": "https://tpar-dashboard.vercel.app/jobs"})
    time.sleep(3)
    out = call("browser_current_url", {})
    cur = json.loads(out["result"]["content"][0]["text"])["url"]
    return "login" in cur


def reauth():
    link = gen_link()
    call("browser_navigate", {"url": link})
    time.sleep(2)
    out = call("browser_current_url", {})
    url = json.loads(out["result"]["content"][0]["text"])["url"]
    idx = url.find("#")
    fragment = url[idx + 1:]
    call("browser_navigate", {"url": f"https://tpar-dashboard.vercel.app/auth/callback/implicit?next=/jobs#{fragment}"})
    time.sleep(5)


if need_reauth():
    print("re-auth needed...")
    reauth()
    print("re-auth done")

# Now nav to /jobs and snap
call("browser_navigate", {"url": "https://tpar-dashboard.vercel.app/jobs"})
time.sleep(4)
out = call("browser_screenshot", {"full_page": False})
for c in out.get("result", {}).get("content", []):
    if c.get("type") == "image":
        img = base64.b64decode(c["data"])
        target = os.path.join(os.path.dirname(__file__), "jobs-page.png")
        with open(target, "wb") as f:
            f.write(img)
        print(f"saved {target} ({len(img)} bytes)")
        break
else:
    print("no image; raw:", json.dumps(out)[:300])
