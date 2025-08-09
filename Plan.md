## Goal
Stand up Terraform-managed Cribl Cloud resources to:
- Create a new Cribl Lake dataset
- Create an OpenTelemetry (OTLP) source that ingests telemetry from `opentelemetry-demo`
- Wire source → destination (dataset) and deploy the changes

## Constraints and assumptions (to verify)
- Using Cribl Cloud (not self-managed). Terraform provider will target your org/workspace.
- We can use the default Worker Group (`default`) unless you prefer a dedicated one.
- `opentelemetry-demo` will run where it can reach the OTLP endpoint (public Cloud workers or a secure ingress).
- Initial approach: single dataset in JSON format with default settings; can evolve to Parquet/optimized schema later.

## What I need from you (please answer)
- Cribl Cloud details:
  - Organization ID (e.g., shown in your Cribl Cloud URL)
  - Workspace ID or name
  - Preferred Worker Group name (or confirm `default`)
- Lake configuration:
  - Lake ID to host the dataset (if unknown, I can help you find it)
  - Dataset ID (human-readable, e.g., `otel_demo`)
  - Desired format: `json` (default) or `parquet`
  - Retention days (or keep platform default)
- OTLP source preferences:
  - Protocol: gRPC on port 4317 (default) or HTTP on 4318
  - Authentication: none, basic, bearer token, or OAuth (provide secrets if needed)
  - Should we send to Routes or directly to a Destination? (default: direct via `connections`)
- Deployment preferences:
  - OK to commit and deploy automatically after `terraform apply`?
  - Name/tag for the commit message

## Discover-and-validate work items
- Provider onboarding
  - Read `terraform-provider-criblio/docs/index.md` for auth and provider schema
  - Decide auth method (Bearer vs OAuth via env vars)
  - Create a minimal `providers.tf` with version `~> 1.4.10` and empty provider block (env-driven)
- Lake dataset
  - Read `docs/resources/cribl_lake_dataset.md`
  - Confirm required: `id`, `lake_id`; choose `format`; optional retention, description, tags
  - Validate the final dataset path/value expected by destinations (`dest_path`)
- Destination (to dataset)
  - Read `docs/resources/destination.md` for `output_dataset`
  - Define an output with a unique `id`, `type = "dataset"`, `dest_path = <dataset id>`
  - Note optional PQ/retry/timestamp settings; start with defaults
- Source (OTLP)
  - Read `docs/resources/source.md` for `input_open_telemetry`
  - Choose `protocol` (grpc/http), `port`, `otlp_version` ("1.3.1" to match current demo), and auth
  - Either set `send_to_routes = false` and `connections = [{ output = <destination id> }]` or keep routes enabled
- Optional routing
  - If using routes, define route rules (either pack-level or plain routes) to forward from source → destination
  - To keep it simple initially, skip routes and use `connections`
- Commit & deploy flow
  - Use `criblio_commit` to capture changes (message, optional group)
  - Use `criblio_deploy` with `id = <group>` and `version = <commit/version>`
  - Validate dependency ordering so deploy happens after config resources

## Implementation plan (incremental)
1) Bootstrap Terraform project
- Files: `providers.tf`, `main.tf`, `variables.tf`, `outputs.tf`, `README.md`
- Configure provider, use env vars for credentials
2) Add Lake dataset
- `criblio_cribl_lake_dataset` with chosen `id`, `lake_id`, `format`, optional retention
3) Add Destination → dataset
- `criblio_destination` with an `output_dataset` block (`id`, `type = "dataset"`, `dest_path = dataset.id`)
4) Add OTLP Source
- `criblio_source` with `input_open_telemetry` (grpc/4317, `otlp_version = "1.3.1"`), `send_to_routes = false`, `connections = [{ output = destination.id }]`
- Optional: TLS/Secrets if required
5) Commit & Deploy
- `criblio_commit` with message like "Provision OTLP source and Lake dataset for otel-demo"
- `criblio_deploy` referencing Worker Group id and commit/version
6) Test
- Run `terraform init/plan/apply`
- From `opentelemetry-demo`, point OTLP exporter to the Cribl OTLP endpoint (host/port from the Source)
- Verify events in Cribl Lake dataset

## Risks / decisions to revisit
- Exposure of OTLP port on Cloud workers (ingress/networking). May need IP allowlist or token auth.
- Dataset format (JSON vs Parquet) and schema evolution for long-term cost/perf
- Routing flexibility vs direct connections; starting simple keeps state smaller
- Multiple datasets for logs/metrics/traces (future split)

## Acceptance criteria
- Terraform apply creates dataset, destination, and OTLP source without errors
- A commit and deploy are executed and reflected in Cribl Cloud
- `opentelemetry-demo` sends data successfully; records land in the target dataset

## Next actions (pending your answers)
- Provide org/workspace/group/lake IDs, dataset name, and OTLP protocol/auth
- Confirm commit/deploy behavior and naming
- I’ll scaffold the Terraform config, commit it to this repo, and run a dry-run plan for your review