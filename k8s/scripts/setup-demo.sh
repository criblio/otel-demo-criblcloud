#!/bin/bash

# Main setup script for OpenTelemetry demo with Cribl Stream integration
set -e

# Get script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TERRAFORM_DIR="$PROJECT_ROOT/terraform"

echo "🎯 Setting up OpenTelemetry demo with Cribl Stream integration"
echo ""

# Step 1: Update submodules
echo "1️⃣  Updating git submodules..."
cd "$PROJECT_ROOT"
git submodule update --init --recursive

# Step 2: Verify terraform is applied
echo ""
echo "2️⃣  Verifying Cribl Stream configuration..."
if [ ! -f "$TERRAFORM_DIR/terraform.tfstate" ]; then
    echo "❌ Error: Terraform state not found"
    echo "   Please run terraform apply first:"
    echo "   cd terraform && ./run_terraform.sh apply"
    exit 1
fi

# Check if outputs are available
if ! (cd "$TERRAFORM_DIR" && terraform output cribl_stream_endpoint >/dev/null 2>&1); then
    echo "❌ Error: Terraform outputs not available"
    echo "   Please ensure terraform has been successfully applied"
    exit 1
fi

# Step 3: Deploy to Kubernetes (configuration via Helm values)
echo ""
echo "3️⃣  Deploying to Kubernetes..."
"$SCRIPT_DIR/deploy-demo.sh"

echo ""
echo "🎉 Setup complete!"
echo ""
echo "The OpenTelemetry demo is now running and sending telemetry data to:"
echo "   🎯 Cribl Stream OTLP endpoint"
echo "   📊 Local Jaeger, Grafana, and Prometheus for observability"
echo ""
echo "Generate some load and check both local dashboards and Cribl Stream for data!"