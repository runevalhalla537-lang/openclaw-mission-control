#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parents[1]
FRONTEND_DIR = ROOT / "frontend"

app = FastAPI(title="OpenClaw Mission Control", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def run_json(cmd: list[str], timeout: int = 20) -> Any:
    try:
        out = subprocess.check_output(cmd, stderr=subprocess.STDOUT, text=True, timeout=timeout)
        out = out.strip()
        if not out:
            return {"ok": True, "empty": True}
        try:
            return json.loads(out)
        except json.JSONDecodeError:
            return {"ok": True, "raw": out}
    except subprocess.CalledProcessError as e:
        return {"ok": False, "error": e.output.strip(), "code": e.returncode}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def http_json(url: str, timeout: int = 3) -> Any:
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:  # nosec B310 (internal local network call)
        return json.loads(r.read().decode("utf-8"))


def model_location(model: str) -> str:
    m = (model or "").strip()
    if m.startswith("ollama/"):
        return "Spark"
    if m.startswith("openai-") or m.startswith("openai/"):
        return "OpenAI"
    return "Jetson"


def strip_provider(model: str) -> str:
    if "/" in (model or ""):
        return model.split("/", 1)[1]
    return model or ""


def jetson_metrics() -> dict[str, Any]:
    cpu_pct = None
    mem_pct = None
    gpu_pct = None

    # CPU via /proc/stat delta
    try:
        def read_cpu() -> tuple[int, int]:
            with open("/proc/stat", "r", encoding="utf-8") as f:
                parts = f.readline().split()[1:]
            vals = [int(x) for x in parts]
            idle = vals[3] + vals[4]
            total = sum(vals)
            return idle, total

        i1, t1 = read_cpu()
        time.sleep(0.15)
        i2, t2 = read_cpu()
        cpu_pct = round(100 * (1 - (i2 - i1) / max(1, (t2 - t1))), 1)
    except Exception:
        pass

    try:
        with open("/proc/meminfo", "r", encoding="utf-8") as f:
            info = f.read()
        mt = int(re.search(r"MemTotal:\s+(\d+)", info).group(1))
        ma = int(re.search(r"MemAvailable:\s+(\d+)", info).group(1))
        mem_pct = round(100 * (1 - ma / mt), 1)
    except Exception:
        pass

    # GPU via tegrastats best-effort (Jetson)
    try:
        out = subprocess.check_output(["tegrastats", "--interval", "100", "--count", "1"], text=True, timeout=2)
        m = re.search(r"GR3D_FREQ\s+(\d+)%", out)
        if m:
            gpu_pct = float(m.group(1))
    except Exception:
        pass

    return {"cpuPercent": cpu_pct, "memPercent": mem_pct, "gpuPercent": gpu_pct}


@app.get("/api/health")
def api_health() -> dict[str, Any]:
    return {
        "service": "mission-control",
        "gateway": run_json(["openclaw", "gateway", "status", "--json"]),
        "status": run_json(["openclaw", "status", "--json"]),
    }


@app.get("/api/agents")
def api_agents() -> Any:
    return run_json(["openclaw", "agents", "list", "--json"])


@app.get("/api/sessions")
def api_sessions() -> Any:
    # CLI supports top-level sessions listing flags, not subcommands.
    return run_json(["openclaw", "sessions", "--all-agents", "--active", "240", "--json"])


@app.get("/api/subagents")
def api_subagents() -> Any:
    # Placeholder until a stable CLI/API subagent listing command is exposed.
    return {"ok": True, "note": "Use sessions panel for active runs in v1."}


@app.get("/api/cron")
def api_cron() -> Any:
    return run_json(["openclaw", "cron", "list", "--all", "--json"])


@app.get("/api/runtime")
def api_runtime() -> Any:
    spark_host = os.getenv("SPARK_OLLAMA", "http://127.0.0.1:11434")
    spark_metrics_url = os.getenv("SPARK_METRICS_URL", "http://127.0.0.1:8766/metrics")

    agents = run_json(["openclaw", "agents", "list", "--json"])
    agent_rows = agents if isinstance(agents, list) else agents.get("agents", []) if isinstance(agents, dict) else []

    spark_online = True
    spark_tags: set[str] = set()
    spark_loaded: set[str] = set()
    spark_error = None
    try:
        tags = http_json(f"{spark_host}/api/tags")
        ps = http_json(f"{spark_host}/api/ps")
        spark_tags = {m.get("name") for m in tags.get("models", []) if m.get("name")}
        spark_loaded = {m.get("name") for m in ps.get("models", []) if m.get("name")}
    except Exception as e:
        spark_online = False
        spark_error = str(e)

    mapped = []
    for a in agent_rows:
        agent_id = a.get("id") or a.get("agentId") or "unknown"
        model = (a.get("model") or {}).get("primary") if isinstance(a.get("model"), dict) else a.get("model")
        model = model or "n/a"
        loc = model_location(model)
        state = "Online"
        if loc == "Spark":
            bare = strip_provider(model)
            if not spark_online:
                state = "Offline"
            elif bare in spark_loaded:
                state = "Warm"
            elif bare in spark_tags:
                state = "Cold (On Demand)"
            else:
                state = "Offline"
        elif loc == "OpenAI":
            state = "Online"

        mapped.append(
            {
                "agentId": agent_id,
                "model": model,
                "location": loc,
                "state": state,
            }
        )

    spark_metrics = {"cpuPercent": None, "memPercent": None, "gpuPercent": None, "source": None}
    try:
        m = http_json(spark_metrics_url)
        spark_metrics = {
            "cpuPercent": m.get("cpuPercent"),
            "memPercent": m.get("memPercent"),
            "gpuPercent": m.get("gpuPercent"),
            "source": m.get("source", "spark-exporter"),
        }
    except Exception:
        pass

    return {
        "agentModels": mapped,
        "jetson": jetson_metrics(),
        "spark": {
            "online": spark_online,
            "error": spark_error,
            "loadedModels": sorted(spark_loaded),
            "knownModels": len(spark_tags),
            "cpuPercent": spark_metrics["cpuPercent"],
            "memPercent": spark_metrics["memPercent"],
            "gpuPercent": spark_metrics["gpuPercent"],
            "metricsSource": spark_metrics["source"],
        },
    }


class CronSwitchAgentBody(BaseModel):
    id: str
    agent: str


@app.post("/api/cron/switch-agent")
def api_cron_switch_agent(body: CronSwitchAgentBody) -> Any:
    return run_json(["openclaw", "cron", "edit", "--id", body.id, "--agent", body.agent, "--json"])


class CronToggleBody(BaseModel):
    id: str
    enabled: bool


@app.post("/api/cron/toggle")
def api_cron_toggle(body: CronToggleBody) -> Any:
    cmd = ["openclaw", "cron", "enable" if body.enabled else "disable", "--id", body.id, "--json"]
    return run_json(cmd)


@app.get("/")
def index() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "index.html")


app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("MC_HOST", "127.0.0.1")
    port = int(os.getenv("MC_PORT", "8787"))
    uvicorn.run("app:app", host=host, port=port, reload=False)
