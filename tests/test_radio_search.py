#!/usr/bin/env python3
import json
import urllib.request

BASE = "http://127.0.0.1:8095"

def get(path):
    return urllib.request.urlopen(f"{BASE}{path}", timeout=10).read().decode()

health = json.loads(get("/api/health"))
print("health:", health)
if health.get("radioSearch") != "v3":
    print("WARNING: old mock server still running. Use tools\\start-mock.ps1")

search = json.loads(get("/api/library/radio/search?q=BBC&limit=3"))
print("BBC count:", len(search.get("stations", [])), "source:", search.get("source"))
for station in search.get("stations", [])[:3]:
    print(" -", station.get("name"))

app = get("/assets/app.js")
print("frontend radioInternetSearch:", "radioInternetSearch" in app)
print("frontend radio panel:", 'data-value="radio"' in app and "activeMorePanel" in app)
