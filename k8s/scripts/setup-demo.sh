#!/bin/bash

# Main setup script for OpenTelemetry demo with Cribl Search integration
set -e

# Get script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "🎯 Setting up OpenTelemetry demo with Cribl Search integration"
echo ""

# Step 1: Update submodules
echo "1️⃣  Updating git submodules..."
cd "$PROJECT_ROOT"
git submodule update --init --recursive

# Step 2: Verify .env configuration
echo ""
echo "2️⃣  Verifying Cribl Search configuration..."
if [ ! -f "$PROJECT_ROOT/.env" ]; then
    echo "❌ Error: .env file not found"
    echo "   Copy .env.example to .env and fill in your Cribl Search configuration:"
    echo "   cp .env.example .env"
    exit 1
fi

# Step 3: Deploy to Kubernetes
echo ""
echo "3️⃣  Deploying to Kubernetes..."
"$SCRIPT_DIR/deploy-demo.sh"

echo ""
echo "🎉 Setup complete!"
echo ""
echo "The OpenTelemetry demo is now running and sending telemetry data to:"
echo "   🎯 Cribl Search OTLP endpoint"
echo "   📊 Local Jaeger, Grafana, and Prometheus for observability"
echo ""
echo "Generate some load and check both local dashboards and Cribl Search for data!"
