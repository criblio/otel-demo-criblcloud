# OpenTelemetry Demo with Cribl Stream Integration

This directory contains scripts and configurations to run the OpenTelemetry demo locally in a kind Kubernetes cluster, configured to send telemetry data to Cribl Stream.

## Prerequisites

- [kind](https://kind.sigs.k8s.io/docs/user/quick-start/#installation) - Kubernetes in Docker
- [kubectl](https://kubernetes.io/docs/tasks/tools/) - Kubernetes CLI
- [helm](https://helm.sh/docs/intro/install/) - Kubernetes package manager
- [curl](https://curl.se/) - For downloading yq if needed
- [base64](https://www.gnu.org/software/coreutils/) - For encoding credentials

## Quick Start

1. **Apply Terraform configuration first:**
   ```bash
   cd terraform
   ./run_terraform.sh apply
   cd ..
   ```

2. **Run the complete setup from anywhere in the project:**
   ```bash
   ./k8s/scripts/setup-demo.sh
   # or from the k8s directory:
   # cd k8s && ./scripts/setup-demo.sh
   # or from the scripts directory:
   # cd k8s/scripts && ./setup-demo.sh
   ```

This will:
- Update git submodules
- Patch the OpenTelemetry collector configuration to send data to Cribl Stream
- Create a kind cluster
- Deploy the demo
- Set up port forwards for local access

## Manual Steps

If you prefer to run steps individually:

1. **Patch the demo configuration:**
   ```bash
   ./k8s/scripts/patch-demo-config.sh
   ```

2. **Deploy to Kubernetes:**
   ```bash
   ./k8s/scripts/deploy-demo.sh
   ```

## Accessing the Demo

Once deployed, access these services:

- **Frontend**: http://localhost:8080 - Demo e-commerce application
- **Jaeger UI**: http://localhost:16686 - Distributed tracing
- **Grafana**: http://localhost:3000 - Metrics and dashboards  
- **Prometheus**: http://localhost:9090 - Metrics storage and queries

## Data Flow

```
Demo Applications → OpenTelemetry Collector → {
  ├── Cribl Stream (your configured endpoint)
  ├── Jaeger (traces)
  ├── Prometheus (metrics)
  └── OpenSearch (logs)
}
```

The collector is configured to send all telemetry data (traces, metrics, logs) to both:
- **Cribl Stream**: Your configured OTLP endpoint with authentication
- **Local observability stack**: For immediate visualization and debugging

## Monitoring

- **Check pod status**: `kubectl get pods -n otel-demo`
- **View collector logs**: `kubectl logs -l app.kubernetes.io/name=opentelemetry-collector -n otel-demo`
- **Check all services**: `kubectl get svc -n otel-demo`

## Configuration Files

- `kind/cluster-config.yaml` - Kind cluster configuration with port mappings
- `patches/otel-collector-config.patch.yaml` - Template for modifying collector config
- `scripts/patch-demo-config.sh` - Applies Cribl Stream configuration to demo
- `scripts/deploy-demo.sh` - Deploys demo to Kubernetes
- `scripts/setup-demo.sh` - Complete setup orchestration

## Cleanup

To remove everything:
```bash
kind delete cluster --name otel-demo-cribl
```

## Troubleshooting

### yq not found
The patch script automatically downloads yq if not installed.

### Terraform outputs not available
Ensure terraform has been applied successfully:
```bash
cd terraform && terraform output
```

### Port forwards not working
Kill existing forwards and redeploy:
```bash
pkill -f "kubectl.*port-forward"
./k8s/scripts/deploy-demo.sh
```

### Collector not sending data to Cribl Stream
Check collector logs and verify credentials:
```bash
kubectl logs -l app.kubernetes.io/name=opentelemetry-collector -n otel-demo -f
```