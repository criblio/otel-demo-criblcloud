# Kubernetes Deployment

Scripts and configuration for running the OpenTelemetry demo in a local Kind cluster, configured to send telemetry to Cribl Search.

## Prerequisites

- [kind](https://kind.sigs.k8s.io/docs/user/quick-start/#installation)
- [kubectl](https://kubernetes.io/docs/tasks/tools/)
- [helm](https://helm.sh/docs/intro/install/)
- A `.env` file at the project root (see `.env.example`)

## Quick Start

```bash
./scripts/setup-demo.sh
```

This will:
- Update git submodules
- Create a Kind cluster
- Configure the OpenTelemetry Collector with your Cribl Search endpoint
- Deploy the demo via Helm
- Set up port forwards for local access

## Manual Steps

Run steps individually if preferred:

```bash
./scripts/deploy-demo.sh
```

## Accessing the Demo

- **Frontend**: http://localhost:8080
- **Jaeger UI**: http://localhost:16686
- **Grafana**: http://localhost:3000
- **Prometheus**: http://localhost:9090

## Data Flow

```
Demo Applications → OpenTelemetry Collector → {
  ├── Cribl Search (your configured endpoint)
  ├── Jaeger (traces)
  ├── Prometheus (metrics)
  └── OpenSearch (logs)
}
```

## Configuration Files

- `kind/cluster-config.yaml` — Kind cluster specification
- `helm-values-cribl.yaml` — Helm values template with Cribl Search exporter config
- `scripts/setup-demo.sh` — Full setup orchestration
- `scripts/deploy-demo.sh` — Kubernetes deployment

## Cleanup

```bash
kind delete cluster --name otel-demo-cribl
```

## Troubleshooting

### Port forwards not working
```bash
pkill -f "kubectl.*port-forward"
./scripts/deploy-demo.sh
```

### Collector not sending data
Check collector logs and verify credentials in `.env`:
```bash
kubectl logs -l app.kubernetes.io/name=opentelemetry-collector -n otel-demo -f
```
