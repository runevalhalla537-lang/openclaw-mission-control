# Install Spark Metrics Exporter (Option A)

Run on Spark host:

```bash
sudo mkdir -p /opt/spark-metrics
sudo cp spark_metrics_exporter.py /opt/spark-metrics/
sudo cp spark-metrics.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now spark-metrics
sudo systemctl status spark-metrics --no-pager
```

Test from Spark:

```bash
curl -s http://127.0.0.1:8766/metrics
```

Test from your Mission Control host:

```bash
curl -s http://<spark-host>:8766/metrics
```

Set in Mission Control service env:

```ini
Environment=SPARK_METRICS_URL=http://<spark-host>:8766/metrics
```
