# Terraform for Cribl Lake + OTLP Source

This configuration creates:
- A Cribl Lake dataset (`criblio_cribl_lake_dataset`)
- A destination pointing to that dataset (`criblio_destination` with `output_dataset`)
- An OpenTelemetry source with Basic Auth over gRPC (`criblio_source` with `input_open_telemetry`)
- A commit and deploy to your Worker Group (`criblio_commit`, `criblio_deploy`)

## Usage

1. Export credentials (example with OAuth):

```bash
export CRIBL_CLIENT_ID=... \
CRIBL_CLIENT_SECRET=... \
CRIBL_ORGANIZATION_ID=${CRIBL_ORGANIZATION_ID:?set} \
CRIBL_WORKSPACE_ID=${CRIBL_WORKSPACE_ID:?set}
```

Or use `CRIBL_BEARER_TOKEN`.

2. Provide required variables (example `terraform.tfvars`):

```hcl
organization_id = "friendly-vaughan-5pyvodc"
workspace_id    = "<your-workspace-id>"
worker_group_id = "default"
lake_id         = "otel_demo"    # Lake ID that contains datasets
dataset_id      = "otel_demo"    # Dataset to create/use
otlp_username   = "otel"
otlp_password   = "<choose-a-secret>"
```

3. Initialize and apply:

```bash
terraform -chdir=terraform init
terraform -chdir=terraform apply
```

4. Point `opentelemetry-demo` to send to the OTLP endpoint (host depends on your Worker Group routing; port is exposed in this config). Provide basic auth credentials.
