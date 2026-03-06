#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import subprocess
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

HOST = "0.0.0.0"
PORT = 8766


def cpu_percent() -> float | None:
    try:
        def read_cpu():
            with open('/proc/stat', 'r', encoding='utf-8') as f:
                vals = [int(x) for x in f.readline().split()[1:]]
            idle = vals[3] + vals[4]
            total = sum(vals)
            return idle, total

        i1, t1 = read_cpu()
        time.sleep(0.15)
        i2, t2 = read_cpu()
        return round(100 * (1 - (i2 - i1) / max(1, (t2 - t1))), 1)
    except Exception:
        return None


def mem_percent() -> float | None:
    try:
        with open('/proc/meminfo', 'r', encoding='utf-8') as f:
            txt = f.read()
        mt = int(re.search(r"MemTotal:\s+(\d+)", txt).group(1))
        ma = int(re.search(r"MemAvailable:\s+(\d+)", txt).group(1))
        return round(100 * (1 - ma / mt), 1)
    except Exception:
        return None


def gpu_percent() -> float | None:
    # NVIDIA dGPU path
    try:
        out = subprocess.check_output([
            'nvidia-smi', '--query-gpu=utilization.gpu', '--format=csv,noheader,nounits'
        ], text=True, timeout=2).strip().splitlines()[0]
        return float(out)
    except Exception:
        pass

    # Jetson path fallback
    try:
        out = subprocess.check_output(['tegrastats', '--interval', '100', '--count', '1'], text=True, timeout=2)
        m = re.search(r"GR3D_FREQ\s+(\d+)%", out)
        if m:
            return float(m.group(1))
    except Exception:
        pass

    return None


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path not in ('/metrics', '/metrics/'):
            self.send_response(404)
            self.end_headers()
            return

        payload = {
            'cpuPercent': cpu_percent(),
            'memPercent': mem_percent(),
            'gpuPercent': gpu_percent(),
            'source': 'spark-exporter-v1',
        }
        data = json.dumps(payload).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        return


if __name__ == '__main__':
    server = HTTPServer((HOST, PORT), Handler)
    server.serve_forever()
