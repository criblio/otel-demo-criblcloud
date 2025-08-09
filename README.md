## Cribl Cloud: Lake dataset + OTLP Source via Terraform

This repo provisions a Cribl Lake dataset, a destination to that dataset, and an OpenTelemetry (OTLP) gRPC source with Basic Auth that ingests from the OpenTelemetry Demo. It also creates a commit and deploys the config to your Worker Group.

### Prerequisites
- Terraform 1.6+
- Cribl Cloud account and credentials
- Network access to your Worker Group's OTLP port (default 4317)

### Authenticate the provider
Use either OAuth (recommended) or a bearer token.

```bash
# OAuth (recommended)
export CRIBL_CLIENT_ID=... \
CRIBL_CLIENT_SECRET=... \
CRIBL_ORGANIZATION_ID=... \
CRIBL_WORKSPACE_ID=...

# OR bearer token
# export CRIBL_BEARER_TOKEN=...
```

### Configure variables
Edit `terraform/terraform.tfvars` and replace placeholders:

```hcl
organization_id = "your-org-id"        # e.g., friendly-vaughan-5pyvodc
workspace_id    = "your-workspace-id"
worker_group_id = "default"
lake_id         = "your-lake-id"
dataset_id      = "otel_demo"
otlp_username   = "otel_user"
otlp_password   = "change-me"
```

Optional dataset settings are commented in that file (`dataset_format`, `dataset_retention_days`).

### Run Terraform
```bash
terraform -chdir=terraform init
terraform -chdir=terraform apply
```
On success, Terraform will:
- Create/update the dataset in your Lake
- Create a dataset destination
- Create an OTLP source (gRPC 4317) with Basic Auth, connected directly to the destination
- Commit and deploy the configuration to `worker_group_id`

### Point the OpenTelemetry Demo at Cribl
The source listens on gRPC port `4317` and requires Basic Auth. Configure OTLP exporter headers to send an Authorization header.

Example using environment variables (replace host and creds):
```bash
# Endpoint of your Cribl OTLP Source (host depends on your Worker Group ingress)
export OTEL_EXPORTER_OTLP_ENDPOINT="https://<your-host>:4317"
export OTEL_EXPORTER_OTLP_PROTOCOL=grpc

# Basic Auth header (username:password -> base64)
# Example for otel_user:change-me -> b3RlbF91c2VyOmNoYW5nZS1tZQ==
export OTEL_EXPORTER_OTLP_HEADERS="authorization=Basic b3RlbF91c2VyOmNoYW5nZS1tZQ=="
```
If the demo separates signal headers, set `OTEL_EXPORTER_OTLP_TRACES_HEADERS`, `..._METRICS_HEADERS`, and `..._LOGS_HEADERS` similarly.

### Notes
- Ensure your Worker Group ingress exposes the OTLP port and, if needed, restrict by IP allowlist or additional auth.
- If the first apply deploys an older version, run apply again; we can adjust the deploy step after initial testing.

### Cleaning up
```bash
terraform -chdir=terraform destroy
```
