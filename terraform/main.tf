locals {
  commit_message = "Provision OTLP source and Lake dataset for otel-demo"
}

# Create or update a dataset in the specified Lake
resource "criblio_cribl_lake_dataset" "otel_demo" {
  id      = var.dataset_id
  lake_id = var.lake_id

  format                    = var.dataset_format
  retention_period_in_days  = var.dataset_retention_days
}

# Destination that writes to the dataset
resource "criblio_destination" "otel_dataset" {
  id       = "otel_dataset"
  group_id = var.worker_group_id

  output_dataset = {
    id        = "otel_dataset"
    type      = "dataset"
    dest_path = criblio_cribl_lake_dataset.otel_demo.id
  }
}

# OpenTelemetry source with basic auth over gRPC and direct connection to the destination
resource "criblio_source" "otel_otlp" {
  id       = "otel_otlp"
  group_id = var.worker_group_id

  input_open_telemetry = {
    type         = "open_telemetry"
    protocol     = var.otlp_protocol
    port         = var.otlp_port
    otlp_version = "1.3.1"

    # Basic auth
    auth_type = "basic"
    username  = var.otlp_username
    password  = var.otlp_password

    send_to_routes = false
    connections = [{
      output = criblio_destination.otel_dataset.id
    }]
  }
}

# Commit config changes
resource "criblio_commit" "apply" {
  message = local.commit_message
  group   = var.worker_group_id
}

# Retrieve available config versions for the group
# (Used to pick the most recent one for deployment)
data "criblio_config_version" "versions" {
  id = var.worker_group_id
}

# Deploy to the worker group using the latest config version
resource "criblio_deploy" "deploy" {
  id      = var.worker_group_id
  version = try(element(data.criblio_config_version.versions.items, length(data.criblio_config_version.versions.items) - 1), "")

  depends_on = [
    criblio_cribl_lake_dataset.otel_demo,
    criblio_destination.otel_dataset,
    criblio_source.otel_otlp,
    criblio_commit.apply,
  ]
}
