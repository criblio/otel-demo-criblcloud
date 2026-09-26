# Failure Scenarios

The OpenTelemetry demo uses [flagd](https://flagd.dev/) to toggle failure scenarios at runtime without restarting the stack.
Use the `flagd-set.sh` script to activate or deactivate any scenario.

## Usage

```bash
./k8s/scripts/flagd-set.sh <flag-name> <variant>
```

Running the script without arguments prints all available flags and variants.

---

## Available Scenarios

### Payment Failures — `paymentFailure`

Causes the payment service to fail a percentage of charge requests.

```bash
# Fail 50% of payments
./k8s/scripts/flagd-set.sh paymentFailure 50%

# Other available rates: 10%, 25%, 75%, 90%, 100%

# Turn off
./k8s/scripts/flagd-set.sh paymentFailure off
```

---

### Payment Service Unreachable — `paymentUnreachable`

Takes the payment service completely offline.

```bash
./k8s/scripts/flagd-set.sh paymentUnreachable on
./k8s/scripts/flagd-set.sh paymentUnreachable off
```

---

### Cart Failure — `cartFailure`

Causes the cart service to return errors.

```bash
./k8s/scripts/flagd-set.sh cartFailure on
./k8s/scripts/flagd-set.sh cartFailure off
```

---

### Product Catalog Failure — `productCatalogFailure`

Fails the product catalog service on a specific product.

```bash
./k8s/scripts/flagd-set.sh productCatalogFailure on
./k8s/scripts/flagd-set.sh productCatalogFailure off
```

---

### Recommendation Cache Failure — `recommendationCacheFailure`

Breaks the recommendation service cache.

```bash
./k8s/scripts/flagd-set.sh recommendationCacheFailure on
./k8s/scripts/flagd-set.sh recommendationCacheFailure off
```

---

### Ad Service Failures — `adFailure`, `adHighCpu`, `adManualGc`

Three independent scenarios for the ad service:

```bash
# Make the ad service return errors
./k8s/scripts/flagd-set.sh adFailure on

# Peg the ad service CPU
./k8s/scripts/flagd-set.sh adHighCpu on

# Trigger repeated full garbage collections
./k8s/scripts/flagd-set.sh adManualGc on

# Turn any of them off
./k8s/scripts/flagd-set.sh adFailure off
./k8s/scripts/flagd-set.sh adHighCpu off
./k8s/scripts/flagd-set.sh adManualGc off
```

---

### Kafka Queue Problems — `kafkaQueueProblems`

Overloads the Kafka queue and introduces a consumer-side delay, causing a visible lag spike.

```bash
./k8s/scripts/flagd-set.sh kafkaQueueProblems on
./k8s/scripts/flagd-set.sh kafkaQueueProblems off
```

---

### Slow Image Loading — `imageSlowLoad`

Artificially delays frontend image loading.

```bash
./k8s/scripts/flagd-set.sh imageSlowLoad 5sec
./k8s/scripts/flagd-set.sh imageSlowLoad 10sec
./k8s/scripts/flagd-set.sh imageSlowLoad off
```

---

### Load Generator Flood — `loadGeneratorFloodHomepage`

Floods the frontend with a large number of requests from the load generator.

```bash
./k8s/scripts/flagd-set.sh loadGeneratorFloodHomepage on
./k8s/scripts/flagd-set.sh loadGeneratorFloodHomepage off
```

---

### Cart Readiness Probe Failure — `failedReadinessProbe`

Makes the cart service fail its readiness probe, so Kubernetes pulls it out of the
service endpoints and cart traffic starts erroring at the proxy.

```bash
./k8s/scripts/flagd-set.sh failedReadinessProbe on
./k8s/scripts/flagd-set.sh failedReadinessProbe off
```

---

### Email Service Memory Leak — `emailMemoryLeak`

Leaks memory in the email service. The variant is a severity multiplier rather than
a simple on/off — higher values leak proportionally faster.

```bash
./k8s/scripts/flagd-set.sh emailMemoryLeak 10x
./k8s/scripts/flagd-set.sh emailMemoryLeak 1000x
./k8s/scripts/flagd-set.sh emailMemoryLeak off
```

---

### LLM Inaccurate Response — `llmInaccurateResponse`

Makes the LLM service return an inaccurate product summary for product ID
`L9ECAV7KIM`. The request still succeeds, so this surfaces as a correctness
problem rather than an error-rate spike.

```bash
./k8s/scripts/flagd-set.sh llmInaccurateResponse on
./k8s/scripts/flagd-set.sh llmInaccurateResponse off
```

---

### LLM Rate Limit Errors — `llmRateLimitError`

Makes the LLM service intermittently return a rate-limit error.

```bash
./k8s/scripts/flagd-set.sh llmRateLimitError on
./k8s/scripts/flagd-set.sh llmRateLimitError off
```

---

## Verifying a Scenario is Active

After running the script, you can confirm the change in k9s:

1. Open k9s: `k9s -n otel-demo`
2. Navigate to ConfigMaps (`:cm`) and find the flagd ConfigMap to inspect the current values
3. Watch the flagd pod logs (`:po` → highlight the `flagd` pod → `l`) for config reload messages
4. Check Jaeger (`http://localhost:16686`) or Grafana (`http://localhost:3000`) for error traces/metrics appearing within a few seconds

> **The flag UI and this script write to different places.** `flagd-set.sh` patches
> the `flagd-config` ConfigMap and restarts flagd, so its changes survive a pod
> restart. The flag UI at `http://localhost:8080/feature` (or `:4000`) writes to the
> emptyDir that an init container populates from the ConfigMap, and never writes back
> to it — so UI toggles are ephemeral and a flagd restart silently reverts them to
> whatever the ConfigMap says. If a scenario seems to turn itself off, this is why.

## Resetting Everything

To turn off all scenarios at once, re-run the deploy script — it reapplies the original Helm values which resets the ConfigMap to its defaults:

```bash
./k8s/scripts/deploy-demo.sh
```
