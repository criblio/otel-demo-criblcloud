#!/bin/bash

# Script to deploy OpenTelemetry demo to kind cluster with Cribl Stream integration
set -e

# Get script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
K8S_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

CLUSTER_NAME="otel-demo-cribl"
DEMO_DIR="$PROJECT_ROOT/opentelemetry-demo"

echo "🚀 Deploying OpenTelemetry demo to kind cluster..."

# Check if kind is installed
if ! command -v kind &> /dev/null; then
    echo "❌ Error: kind is required but not installed"
    echo "   Installation: https://kind.sigs.k8s.io/docs/user/quick-start/#installation"
    exit 1
fi

# Check if kubectl is installed
if ! command -v kubectl &> /dev/null; then
    echo "❌ Error: kubectl is required but not installed"
    echo "   Installation: https://kubernetes.io/docs/tasks/tools/"
    exit 1
fi

# Check if helm is installed
if ! command -v helm &> /dev/null; then
    echo "❌ Error: helm is required but not installed"
    echo "   Installation: https://helm.sh/docs/intro/install/"
    exit 1
fi

# Check if cluster exists
if ! kind get clusters | grep -q "^${CLUSTER_NAME}$"; then
    echo "🏗️  Creating kind cluster: $CLUSTER_NAME"
    kind create cluster --config "$K8S_DIR/kind/cluster-config.yaml"
else
    echo "♻️  Using existing kind cluster: $CLUSTER_NAME"
fi

# Set kubectl context
echo "🔧 Setting kubectl context..."
kubectl cluster-info --context kind-${CLUSTER_NAME}

# Add OpenTelemetry Helm repository
echo "📦 Adding OpenTelemetry Helm repository..."
helm repo add open-telemetry https://open-telemetry.github.io/opentelemetry-helm-charts
helm repo update

# Create namespace
echo "📦 Creating otel-demo namespace..."
kubectl create namespace otel-demo --dry-run=client -o yaml | kubectl apply -f -

# Load Cribl configuration from .env
echo "🔧 Configuring OpenTelemetry collector for Cribl Search..."
ENV_FILE="$PROJECT_ROOT/.env"
VALUES_TEMPLATE="$K8S_DIR/helm-values-cribl.yaml"
VALUES_FILE="$K8S_DIR/helm-values-processed.yaml"

if [[ ! -f "$ENV_FILE" ]]; then
    echo "❌ Error: .env file not found at project root"
    echo "   Copy .env.example to .env and fill in your Cribl Search configuration"
    exit 1
fi

source "$ENV_FILE"

if [[ -z "$CRIBL_ENDPOINT" || -z "$CRIBL_USERNAME" || -z "$CRIBL_PASSWORD" ]]; then
    echo "❌ Error: Missing required configuration in .env"
    echo "   Required: CRIBL_ENDPOINT, CRIBL_USERNAME, CRIBL_PASSWORD"
    exit 1
fi

AUTH_HEADER=$(echo -n "${CRIBL_USERNAME}:${CRIBL_PASSWORD}" | base64 -w 0)

sed -e "s/__CRIBL_ENDPOINT__/${CRIBL_ENDPOINT}/g" \
    -e "s/__AUTH_HEADER__/${AUTH_HEADER}/g" \
    "$VALUES_TEMPLATE" > "$VALUES_FILE"

echo "✅ Cribl configuration loaded: https://$CRIBL_ENDPOINT"

# Deploy using Helm
echo "📦 Deploying OpenTelemetry demo with Helm..."
helm upgrade --install opentelemetry-demo open-telemetry/opentelemetry-demo \
    --namespace otel-demo \
    --values "$VALUES_FILE" \
    --wait --timeout=600s

# Wait for deployment to be ready
echo "⏳ Waiting for services to be ready..."
kubectl wait --for=condition=available --timeout=300s deployment --all -n otel-demo

echo "🌐 Setting up port forwards for demo services..."

# Kill any existing port forwards
pkill -f "kubectl.*port-forward" || true

# Set up port forwards in background
nohup kubectl port-forward --address 0.0.0.0 svc/frontend-proxy 8080:8080 -n otel-demo > /dev/null 2>&1 &
nohup kubectl port-forward --address 0.0.0.0 svc/jaeger 16686:16686 -n otel-demo > /dev/null 2>&1 &
nohup kubectl port-forward --address 0.0.0.0 svc/grafana 3000:80 -n otel-demo > /dev/null 2>&1 &
nohup kubectl port-forward --address 0.0.0.0 svc/prometheus 9090:9090 -n otel-demo > /dev/null 2>&1 &
nohup kubectl port-forward --address 0.0.0.0 svc/opensearch 9300:9300 -n otel-demo > /dev/null 2>&1 &

# Wait a bit for port forwards to establish
sleep 3

echo ""
echo "✅ OpenTelemetry demo deployed successfully!"
echo ""
echo "🌐 Access the demo:"
echo "   Frontend:   http://localhost:8080"
echo "   Jaeger UI:  http://localhost:16686"
echo "   Grafana:    http://localhost:3000"
echo "   Prometheus: http://localhost:9090"
echo ""
echo "🔍 Monitor the cluster:"
echo "   kubectl get pods -n otel-demo"
echo "   kubectl logs -l app.kubernetes.io/name=opentelemetry-collector -n otel-demo"
echo ""
echo "🛑 To cleanup:"
echo "   kind delete cluster --name $CLUSTER_NAME"
