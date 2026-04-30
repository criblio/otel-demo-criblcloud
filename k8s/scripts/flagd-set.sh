#!/bin/bash

# Set a flagd feature flag variant in the running k8s otel-demo deployment.
# Usage: flagd-set.sh <flag-name> <variant>
#
# Examples:
#   flagd-set.sh paymentFailure 50%
#   flagd-set.sh paymentFailure off
#   flagd-set.sh cartFailure on
#   flagd-set.sh productCatalogFailure on

set -e

NAMESPACE="otel-demo"
FLAG_NAME="$1"
VARIANT="$2"

if [[ -z "$FLAG_NAME" || -z "$VARIANT" ]]; then
    echo "Usage: $0 <flag-name> <variant>"
    echo ""
    echo "Available flags and variants:"
    echo "  paymentFailure       : 100%, 90%, 75%, 50%, 25%, 10%, off"
    echo "  paymentUnreachable   : on, off"
    echo "  cartFailure          : on, off"
    echo "  productCatalogFailure: on, off"
    echo "  recommendationCache  : on, off"
    echo "  adFailure            : on, off"
    echo "  adHighCpu            : on, off"
    echo "  adManualGc           : on, off"
    echo "  kafkaQueueProblems   : on, off"
    echo "  imageSlowLoad        : 10sec, 5sec, off"
    echo "  loadGeneratorFlood   : on, off"
    exit 1
fi

# Find the flagd ConfigMap
CONFIGMAP=$(kubectl get configmap -n "$NAMESPACE" -o name | grep flagd | head -1)
if [[ -z "$CONFIGMAP" ]]; then
    echo "❌ Could not find flagd ConfigMap in namespace '$NAMESPACE'"
    exit 1
fi

echo "📋 ConfigMap: $CONFIGMAP"

# Extract current flags JSON
CURRENT_JSON=$(kubectl get "$CONFIGMAP" -n "$NAMESPACE" -o jsonpath='{.data.demo\.flagd\.json}')
if [[ -z "$CURRENT_JSON" ]]; then
    echo "❌ Could not read demo.flagd.json from ConfigMap"
    exit 1
fi

# Check that the flag exists
if ! echo "$CURRENT_JSON" | python3 -c "import sys, json; d=json.load(sys.stdin); assert '$FLAG_NAME' in d['flags']" 2>/dev/null; then
    echo "❌ Flag '$FLAG_NAME' not found. Available flags:"
    echo "$CURRENT_JSON" | python3 -c "import sys, json; [print(' ', f) for f in json.load(sys.stdin)['flags']]"
    exit 1
fi

# Check that the variant exists for this flag
if ! echo "$CURRENT_JSON" | python3 -c "import sys, json; d=json.load(sys.stdin); assert '$VARIANT' in d['flags']['$FLAG_NAME']['variants']" 2>/dev/null; then
    echo "❌ Variant '$VARIANT' not valid for flag '$FLAG_NAME'. Available variants:"
    echo "$CURRENT_JSON" | python3 -c "import sys, json; d=json.load(sys.stdin); [print(' ', v) for v in d['flags']['$FLAG_NAME']['variants']]"
    exit 1
fi

# Patch the defaultVariant
PATCHED_JSON=$(echo "$CURRENT_JSON" | python3 -c "
import sys, json
d = json.load(sys.stdin)
d['flags']['$FLAG_NAME']['defaultVariant'] = '$VARIANT'
print(json.dumps(d, indent=2))
")

# Apply via kubectl patch
kubectl patch "$CONFIGMAP" -n "$NAMESPACE" \
    --type merge \
    -p "{\"data\":{\"demo.flagd.json\": $(echo "$PATCHED_JSON" | python3 -c "import sys, json; print(json.dumps(sys.stdin.read()))")}}"

echo "✅ Flag '$FLAG_NAME' set to '$VARIANT'"

# Restart flagd pod to reload the config
FLAGD_POD=$(kubectl get pods -n "$NAMESPACE" -o name | grep flagd | grep -v flagd-ui | head -1)
if [[ -n "$FLAGD_POD" ]]; then
    echo "🔄 Restarting flagd pod to reload config..."
    kubectl delete "$FLAGD_POD" -n "$NAMESPACE"
    echo "⏳ Waiting for flagd to come back up..."
    kubectl wait --for=condition=ready pod -l app.kubernetes.io/component=flagd -n "$NAMESPACE" --timeout=60s
    echo "✅ flagd is ready"
else
    echo "⚠️  Could not find flagd pod — you may need to restart it manually"
fi
