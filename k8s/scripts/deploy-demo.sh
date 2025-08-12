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

# Process Helm values file with Cribl Stream configuration
echo "🔧 Configuring OpenTelemetry collector for Cribl Stream..."
CRIBL_CONFIG_FILE="$PROJECT_ROOT/terraform/terraform.tfvars"
VALUES_TEMPLATE="$K8S_DIR/helm-values-cribl.yaml"
VALUES_FILE="$K8S_DIR/helm-values-processed.yaml"

# Read Cribl Stream configuration from terraform
if [[ -f "$CRIBL_CONFIG_FILE" ]]; then
    # Get endpoint from terraform output
    CRIBL_ENDPOINT=$(cd "$PROJECT_ROOT/terraform" && terraform output -raw cribl_stream_endpoint 2>/dev/null)
    # Get credentials from tfvars
    CRIBL_USERNAME=$(grep '^otlp_username.*=' "$CRIBL_CONFIG_FILE" | sed 's/.*= *"//' | sed 's/".*//')
    CRIBL_PASSWORD=$(grep '^otlp_password.*=' "$CRIBL_CONFIG_FILE" | sed 's/.*= *"//' | sed 's/".*//')
    
    if [[ -n "$CRIBL_ENDPOINT" && -n "$CRIBL_USERNAME" && -n "$CRIBL_PASSWORD" ]]; then
        AUTH_HEADER=$(echo -n "${CRIBL_USERNAME}:${CRIBL_PASSWORD}" | base64 -w 0)
        
        # Process template
        sed -e "s/__CRIBL_ENDPOINT__/${CRIBL_ENDPOINT}/g" \
            -e "s/__AUTH_HEADER__/${AUTH_HEADER}/g" \
            "$VALUES_TEMPLATE" > "$VALUES_FILE"
            
        echo "✅ Cribl Stream configuration loaded: https://$CRIBL_ENDPOINT"
    else
        echo "⚠️  Warning: Cribl Stream configuration not found, using default values"
        cp "$VALUES_TEMPLATE" "$VALUES_FILE"
    fi
else
    echo "⚠️  Warning: terraform.tfvars not found, using default values"
    cp "$VALUES_TEMPLATE" "$VALUES_FILE"
fi

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
nohup kubectl port-forward svc/frontend-proxy 8080:8080 -n otel-demo > /dev/null 2>&1 &
nohup kubectl port-forward svc/jaeger 16686:16686 -n otel-demo > /dev/null 2>&1 &
nohup kubectl port-forward svc/grafana 3000:3000 -n otel-demo > /dev/null 2>&1 &
nohup kubectl port-forward svc/prometheus-server 9090:9090 -n otel-demo > /dev/null 2>&1 &

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