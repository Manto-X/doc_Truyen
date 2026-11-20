#!/usr/bin/env python3
"""
Cloudflare Worker Deployment Tool via REST API (Zero-Dependency Python)
Deploys ES Module worker to Cloudflare Workers without requiring Node/Wrangler.
"""
import os
import sys
import json
import urllib.request
import urllib.error
from pathlib import Path

WORKER_DIR = Path(__file__).resolve().parent / "cloudflare-worker"
SOURCE_FILE = WORKER_DIR / "worker_all_in_one.js"
ENV_FILE = WORKER_DIR / ".env.deploy"

def load_env():
    """Load configuration from .env.deploy or OS environment."""
    config = {}
    if ENV_FILE.exists():
        with open(ENV_FILE, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    config[k.strip()] = v.strip().strip("'\"")
    # OS environment overrides
    for key in ["CF_ACCOUNT_ID", "CF_API_TOKEN", "CF_WORKER_NAME"]:
        if os.getenv(key):
            config[key] = os.getenv(key)
    return config

def mask(val: str) -> str:
    if not val:
        return "None"
    if len(val) <= 8:
        return val[:3] + "..."
    return val[:5] + "..." + val[-5:]

def deploy():
    config = load_env()
    account_id = config.get("CF_ACCOUNT_ID", "23070b0e0d1ca9bfda5a31bedf86738f")
    api_token = config.get("CF_API_TOKEN")
    worker_name = config.get("CF_WORKER_NAME", "story-reader-bridge")

    if not api_token:
        print("ERROR: Missing CF_API_TOKEN.")
        print(f"Please create {ENV_FILE} or set CF_API_TOKEN environment variable.")
        print("Format in .env.deploy:")
        print("  CF_ACCOUNT_ID=23070b0e0d1ca9bfda5a31bedf86738f")
        print("  CF_API_TOKEN=your_token_here")
        print("  CF_WORKER_NAME=story-reader-bridge")
        sys.exit(1)

    if not SOURCE_FILE.exists():
        print(f"ERROR: Source file not found: {SOURCE_FILE}")
        sys.exit(1)

    script_content = SOURCE_FILE.read_text(encoding="utf-8")
    print(f"Deploying Worker: '{worker_name}' to Account: '{mask(account_id)}'...")
    print(f"Token: {mask(api_token)} | Source size: {len(script_content)} bytes")

    # Cloudflare REST API requires multipart/form-data for ES Module scripts
    boundary = "----CloudflareWorkerBoundary" + os.urandom(8).hex()

    metadata = {
        "main_module": "worker.js",
        "compatibility_date": "2024-09-23"
    }

    body = bytearray()
    # Part 1: Metadata JSON
    body.extend(f"--{boundary}\r\n".encode("utf-8"))
    body.extend(b'Content-Disposition: form-data; name="metadata"\r\n')
    body.extend(b'Content-Type: application/json\r\n\r\n')
    body.extend(json.dumps(metadata).encode("utf-8"))
    body.extend(b"\r\n")

    # Part 2: worker.js source code
    body.extend(f"--{boundary}\r\n".encode("utf-8"))
    body.extend(b'Content-Disposition: form-data; name="worker.js"; filename="worker.js"\r\n')
    body.extend(b'Content-Type: application/javascript+module\r\n\r\n')
    body.extend(script_content.encode("utf-8"))
    body.extend(b"\r\n")

    body.extend(f"--{boundary}--\r\n".encode("utf-8"))

    api_url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/workers/scripts/{worker_name}"

    req = urllib.request.Request(api_url, data=body, method="PUT")
    req.add_header("Authorization", f"Bearer {api_token}")
    req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            resp_body = resp.read().decode("utf-8")
            data = json.loads(resp_body)
            if data.get("success"):
                result = data.get("result", {})
                print("\n==================================================")
                print("SUCCESSFULLY DEPLOYED TO CLOUDFLARE WORKER!")
                print(f"Worker Name : {result.get('id', worker_name)}")
                print(f"Created On  : {result.get('created_on')}")
                print(f"Modified On : {result.get('modified_on')}")
                print(f"Live URL    : https://{worker_name}.tomytran.workers.dev")
                print("==================================================\n")
            else:
                print("Deploy returned success=false:", data)
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="ignore")
        print(f"\nHTTP ERROR {e.code}: {e.reason}")
        try:
            err_json = json.loads(err_body)
            for err in err_json.get("errors", []):
                print(f"  - [{err.get('code')}] {err.get('message')}")
        except:
            print(err_body)
        sys.exit(1)
    except Exception as e:
        print(f"Unexpected error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    deploy()
