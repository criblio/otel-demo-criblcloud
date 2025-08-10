variable "organization_id" {
  description = "Cribl Cloud organization ID"
  type        = string
}

variable "workspace_id" {
  description = "Cribl Cloud workspace ID"
  type        = string
}

variable "worker_group_id" {
  description = "Worker Group ID to target (e.g., default)"
  type        = string
  default     = "default"
}

variable "lake_id" {
  description = "Cribl Lake ID that contains datasets"
  type        = string
  default     = "default"
}

variable "dataset_id" {
  description = "Dataset ID to create/use for otel-demo"
  type        = string
  default     = "otel_demo"
}

variable "dataset_format" {
  description = "Dataset format: json | parquet | ddss"
  type        = string
  default     = "json"
}

variable "dataset_retention_days" {
  description = "Retention for dataset (days)"
  type        = number
  default     = null
}

variable "otlp_protocol" {
  description = "OTLP protocol: grpc | http"
  type        = string
  default     = "grpc"
}

variable "otlp_port" {
  description = "OTLP listen port"
  type        = number
  default     = 4317
}

variable "otlp_username" {
  description = "Basic auth username for OTLP source"
  type        = string
  sensitive   = true
  default     = null
}

variable "otlp_password" {
  description = "Basic auth password for OTLP source"
  type        = string
  sensitive   = true
  default     = null
}
