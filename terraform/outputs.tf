output "dataset_id" {
  description = "Cribl Lake dataset ID"
  value       = criblio_cribl_lake_dataset.otel_demo.id
}

output "destination_id" {
  description = "Destination ID forwarding to dataset"
  value       = criblio_destination.otel_dataset.id
}

output "otlp_endpoint" {
  description = "OTLP gRPC endpoint host:port (port only here; host depends on worker deployment)"
  value       = var.otlp_port
}
