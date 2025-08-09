# Replace placeholder values before running terraform

# Provider targeting (read by our configs for clarity; auth still uses env vars)
organization_id = "your-org-id"        # e.g., friendly-vaughan-5pyvodc
workspace_id    = "your-workspace-id"  # required
worker_group_id = "default"            # or your target Worker Group

# Cribl Lake
lake_id    = "your-lake-id"   # Lake that will contain the dataset
dataset_id = "otel_demo"      # Dataset to create/use

# Optional dataset settings
# dataset_format         = "json"   # json | parquet | ddss
# dataset_retention_days = 7         # number of days

# OTLP Source (Basic Auth over gRPC)
otlp_username = "otel_user"
otlp_password = "change-me"
