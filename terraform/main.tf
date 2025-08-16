locals {
  commit_message = "Provision OTLP source and Lake dataset for otel-demo"
}

# Create or update a dataset in the specified Lake
resource "criblio_cribl_lake_dataset" "otel_demo" {
  id      = var.dataset_id
  lake_id = var.lake_id
  bucket_name = "lake-${var.workspace_id}-${var.organization_id}"

  format                    = var.dataset_format
  retention_period_in_days  = var.dataset_retention_days
}

# Destination that writes to the dataset
resource "criblio_destination" "otel_demo" {
  id       = "otel_demo"
  group_id = var.worker_group_id

  output_cribl_lake = {
    id                                = "otel_demo"
    type                              = "cribl_lake"
    description                       = "Cribl Lake destination for otel data"
    disabled                          = false
    streamtags                        = ["otel", "lake"]
    dest_path                         = criblio_cribl_lake_dataset.otel_demo.id
    format                            = "json"
    compress                          = "gzip"
    add_id_to_stage_path              = true
    aws_authentication_method         = "auto"
    base_file_name                    = "CriblOut"
    file_name_suffix                  = ".gz"
    max_file_size_mb                  = 32
    max_open_files                    = 100
    write_high_water_mark             = 64
    on_backpressure                   = "block"
    deadletter_enabled                = false
    on_disk_full_backpressure         = "block"
    max_file_open_time_sec            = 300
    max_file_idle_time_sec            = 30
    verify_permissions                = true
    max_closing_files_to_backpressure = 100
    max_concurrent_file_parts         = 1
    empty_dir_cleanup_sec             = 300
    max_retry_num                     = 20
  }
}

# OpenTelemetry source with basic auth over gRPC and direct connection to the destination
resource "criblio_source" "otel_otlp" {
  id       = "otel_otlp"
  group_id = var.worker_group_id

  depends_on = [criblio_destination.otel_demo]

  input_open_telemetry = {
    id                      = "otel_otlp"
    type                    = "open_telemetry"
    protocol                = var.otlp_protocol
    port                    = var.otlp_port
    otlp_version            = "1.3.1"
    host                    = "0.0.0.0"
    
    # TLS configuration to enable encrypted connections
    tls = {
      disabled        = false
      request_cert    = false
      cert_path       = "$CRIBL_CLOUD_CRT"
      min_version     = "TLSv1.2"
      priv_key_path   = "$CRIBL_CLOUD_KEY"
    }
    
    # Basic auth (only when credentials are provided)
    auth_type               = "basic"
    username                = var.otlp_username
    password                = var.otlp_password
    auth_header_expr        = "true"
   
    
    # Connection settings
    send_to_routes          = false
    connections = [{
      output = criblio_destination.otel_demo.id
    }]
    
    # OTLP specific settings
    extract_logs            = true
    extract_metrics         = true
    extract_spans           = true
    enable_health_check     = false
    
    # Network settings
    ip_allowlist_regex      = "/.*/"
    ip_denylist_regex       = "/^$/"
    keep_alive_timeout      = 15
    max_active_cxn          = 1000
    max_active_req          = 256
    max_requests_per_socket = 0
    request_timeout          = 0
    socket_timeout           = 0
    
    # Other settings
    disabled                = false
    streamtags              = []
    token_timeout_secs      = 3600
  }
}

# Commit config changes
resource "criblio_commit" "apply" {
  message   = local.commit_message
  group     = var.worker_group_id
  effective = true
  
  depends_on = [
    criblio_cribl_lake_dataset.otel_demo,
    criblio_destination.otel_demo,
    criblio_source.otel_otlp,
  ]
}

# Retrieve available config versions for the group
# (Used to pick the most recent one for deployment)
data "criblio_config_version" "versions" {
  id = var.worker_group_id
  depends_on = [criblio_commit.apply]
}

# Deploy to the worker group using the latest config version
resource "criblio_deploy" "deploy" {
  id      = var.worker_group_id
  version = try(element(data.criblio_config_version.versions.items, length(data.criblio_config_version.versions.items) - 1), "")

  depends_on = [
    data.criblio_config_version.versions,
  ]
}
