# OpenTelemetry Demo with Cribl Search

Run the [OpenTelemetry Demo](https://github.com/open-telemetry/opentelemetry-demo) application locally and send telemetry (traces, metrics, logs) to Cribl Search.

## Architecture

```
OpenTelemetry Demo (Kind Kubernetes cluster)
    └── OpenTelemetry Collector
         ├→ Cribl Search (OTLP gRPC with TLS + Basic Auth)
         └→ Local backends (Jaeger, Grafana, Prometheus)
```

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/)
- [kind](https://kind.sigs.k8s.io/docs/user/quick-start/#installation)
- [kubectl](https://kubernetes.io/docs/tasks/tools/)
- [Helm](https://helm.sh/docs/intro/install/) (>= 3.0)
- A Cribl Search environment with an OTLP source configured

## Quick Start

1. **Configure your Cribl Search connection:**
   ```bash
   cp .env.example .env
   # Edit .env with your endpoint and credentials
   ```

2. **Run the setup:**
   ```bash
   ./k8s/scripts/setup-demo.sh
   ```

3. **Access the demo:**

   | Service | URL |
   |---------|-----|
   | Demo Frontend | http://localhost:8080 |
   | Jaeger UI | http://localhost:16686 |
   | Grafana | http://localhost:3000 |
   | Prometheus | http://localhost:9090 |

## Configuration

The `.env` file requires three values:

| Variable | Description | Example |
|----------|-------------|---------|
| `CRIBL_ENDPOINT` | OTLP endpoint for your Cribl Search environment | `default.main.my-org.cribl.cloud:20000` |
| `CRIBL_USERNAME` | Basic auth username | `cribl_user` |
| `CRIBL_PASSWORD` | Basic auth password | `my_password` |

## Monitoring

```bash
# Check pod status
kubectl get pods -n otel-demo

# View collector logs
kubectl logs -l app.kubernetes.io/name=opentelemetry-collector -n otel-demo
```

## Cleanup

```bash
kind delete cluster --name otel-demo-cribl
```
