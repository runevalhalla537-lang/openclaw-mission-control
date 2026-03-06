# OpenClaw Mission Control

Local-first Mission Control dashboard for OpenClaw + sub-agents.

Designed to run on your own host (Jetson, server, workstation) and be accessed privately over Tailscale.

## Features

- Agent cards with:
  - display name
  - role/use-case
  - model + model location (OpenAI / Spark / local)
  - live status (working vs idle)
- Sub-agent activity panel with current state/task hints
- Cron panel:
  - list jobs
  - enable/disable
  - switch assigned agent
- Runtime panel:
  - per-agent model state: Online / Warm / Cold (On Demand) / Offline
  - Jetson CPU / Memory / GPU utilization bars
  - Spark CPU / Memory / GPU utilization bars (via optional exporter)

## Repository layout

- `backend/` — FastAPI API and runtime aggregation
- `frontend/` — static UI (HTML/CSS/JS)
- `systemd/mission-control.service` — service unit for auto-start
- `spark-metrics/` — optional Spark metrics exporter + service
- `setup.sh` — local virtualenv/bootstrap helper

## Quick start (from scratch)

### 1) Clone and install deps

```bash
git clone https://github.com/<your-org>/openclaw-mission-control.git
cd openclaw-mission-control
bash setup.sh
```

### 2) Run

```bash
source .venv/bin/activate
MC_HOST=0.0.0.0 \
MC_PORT=8787 \
OPENCLAW_BIN=/home/<user>/.npm-global/bin/openclaw \
SPARK_OLLAMA=http://<spark-host>:11434 \
SPARK_METRICS_URL=http://<spark-host>:8766/metrics \
python backend/app.py
```

Open:
- `http://127.0.0.1:8787` (local)
- `http://<tailnet-hostname>:8787` (Tailscale)

## Public demo config (copy/paste)

### Mission Control host env

```bash
MC_HOST=0.0.0.0
MC_PORT=8787
OPENCLAW_BIN=/home/<user>/.npm-global/bin/openclaw
SPARK_OLLAMA=http://<spark-host>:11434
SPARK_METRICS_URL=http://<spark-host>:8766/metrics
```

### systemd env block

```ini
Environment=MC_HOST=0.0.0.0
Environment=MC_PORT=8787
Environment=OPENCLAW_BIN=/home/<user>/.npm-global/bin/openclaw
Environment=SPARK_OLLAMA=http://<spark-host>:11434
Environment=SPARK_METRICS_URL=http://<spark-host>:8766/metrics
Environment=PATH=/home/<user>/.npm-global/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
```

### Spark exporter quick run

```bash
python3 spark_metrics_exporter.py
# serves http://0.0.0.0:8766/metrics
```

## systemd auto-start

```bash
sudo cp systemd/mission-control.service /etc/systemd/system/
# edit env placeholders in /etc/systemd/system/mission-control.service as needed
sudo systemctl daemon-reload
sudo systemctl enable --now mission-control
sudo systemctl status mission-control --no-pager
```

## Optional: Spark host metrics exporter (Option A)

Mission Control can ingest Spark host CPU/MEM/GPU metrics from a tiny local exporter.

Files:
- `spark-metrics/spark_metrics_exporter.py`
- `spark-metrics/spark-metrics.service`
- `spark-metrics/INSTALL_ON_SPARK.md`

After installing on Spark, `/api/runtime` will display Spark utilization bars.

## Security notes

- Keep this dashboard private (Tailscale/private network).
- If exposed beyond private network, add auth at reverse proxy or app layer.
- This public repo uses placeholders and does not include private IPs, secrets, or personal tokens.
