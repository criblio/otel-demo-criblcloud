# OpenTelemetry Demo with Cribl Stream Integration

This project demonstrates how to integrate the OpenTelemetry Demo application with Cribl Stream for advanced observability data processing and routing to Cribl Lake with Lakehouse acceleration.

## Overview

The demo combines:
- **OpenTelemetry Demo**: A microservices-based e-commerce application with comprehensive telemetry
- **Cribl Stream**: Cloud-based data processing and routing for observability data
- **Cribl Lake**: Scalable data lake with Lakehouse acceleration for fast queries
- **Local Observability**: Jaeger, Grafana, and Prometheus for immediate visualization

## Architecture

```
OpenTelemetry Demo (Kind Kubernetes) 
    ↓ OTLP gRPC with TLS + Basic Auth
Cribl Stream Cloud (Worker Group)
    ↓ Processed & Routed Data
Cribl Lake Dataset + Lakehouse Acceleration
    ↓ Fast Queries & Analytics
Local Dashboards (Jaeger, Grafana, Prometheus)
```

## Prerequisites

Before starting, ensure you have the following installed:
- **Terraform** (>= 1.0)
- **kubectl** 
- **kind** (Kubernetes in Docker)
- **Helm** (>= 3.0)
- **Docker**
- **Access to Cribl Cloud** with appropriate permissions

## Setup Guide

### 1. Configure Cribl Stream Infrastructure

First, set up the Cribl Stream source, destination, and Lake dataset:

```bash
cd terraform

# Copy the template and configure your environment
cp terraform.tfvars.template terraform.tfvars

# Edit terraform.tfvars with your Cribl Cloud credentials:
# - organization_id
# - workspace_id  
# - worker_group_id (usually "default")
# - otlp_username and otlp_password for secure OTLP ingestion
vim terraform.tfvars

# Apply the Terraform configuration
./run_terraform.sh apply
```

This will create:
- **Cribl Lake Dataset** with Lakehouse acceleration enabled
- **OTLP Source** with TLS and basic authentication
- **Lake Destination** for processed data storage
- **Accelerated fields** for fast querying: timestamp, service.name, trace.span_id, log.level, resource.service.name

### 2. Deploy OpenTelemetry Demo to Kubernetes

With Cribl Stream configured, deploy the demo application:

```bash
cd k8s

# This script will:
# 1. Create/use existing kind cluster
# 2. Configure OpenTelemetry Collector with Cribl Stream endpoint
# 3. Deploy the demo application via Helm
# 4. Set up port-forwards for local access
./scripts/setup-demo.sh
```

### 3. Access and Monitor

Once deployed, access the services:

| Service | URL | Purpose |
|---------|-----|---------|
| **Demo Frontend** | http://localhost:8080 | E-commerce application |
| **Jaeger UI** | http://localhost:16686 | Distributed tracing |
| **Grafana** | http://localhost:3000 | Metrics dashboards |
| **Prometheus** | http://localhost:9090 | Metrics collection |

### 4. Generate and Observe Data

The demo automatically generates realistic telemetry data:
- **Browse the store** at http://localhost:8080 to generate traces
- **View traces** in Jaeger to see request flows
- **Check metrics** in Grafana for service performance
- **Monitor in Cribl Cloud** to see data flowing through Stream to Lake

## Data Flow Details

### Telemetry Generation
The OpenTelemetry Demo generates:
- **Traces**: Complete request journeys through 10+ microservices
- **Metrics**: Service performance, business KPIs, and infrastructure metrics  
- **Logs**: Structured application and infrastructure logs

### Processing Pipeline
1. **Collection**: OpenTelemetry Collector receives all telemetry
2. **Routing**: Data sent to both local backends AND Cribl Stream
3. **Processing**: Cribl Stream processes and enriches data
4. **Storage**: Data stored in Cribl Lake with Lakehouse acceleration
5. **Analysis**: Fast queries enabled by accelerated fields

## Configuration Options

### Lakehouse Acceleration
The deployment enables Lakehouse acceleration by default with these fields:
- `timestamp` - for time-based filtering
- `service.name` - for service-specific queries
- `trace.span_id` - for trace correlation
- `log.level` - for log severity filtering  
- `resource.service.name` - for resource identification

To customize, edit `terraform/variables.tf`:
```hcl
variable "lakehouse_accelerated_fields" {
  default = ["your", "custom", "fields"]
}
```

### OTLP Configuration
Security and networking settings can be adjusted in `terraform/variables.tf`:
- `otlp_protocol`: "grpc" or "http"
- `otlp_port`: Default 4317 for gRPC
- Authentication credentials for secure ingestion

## Monitoring and Troubleshooting

### Check Kubernetes Status
```bash
kubectl get pods -n otel-demo
kubectl logs -l app.kubernetes.io/name=opentelemetry-collector -n otel-demo
```

### Verify Cribl Stream Connection
```bash
cd terraform
terraform output cribl_stream_endpoint
```

### Monitor Data Flow
- Check Cribl Stream UI for data ingestion
- Verify Lake dataset has incoming data
- Use Lakehouse for fast query performance

## Cleanup

### Remove Kubernetes Resources
```bash
kind delete cluster --name otel-demo-cribl
```

### Remove Cribl Stream Configuration
```bash
cd terraform
./run_terraform.sh destroy
```

## Documentation

- [Terraform Configuration Details](terraform/README.md)
- [Kubernetes Deployment Guide](k8s/README.md)  
- [OpenTelemetry Demo Documentation](opentelemetry-demo/README.md)

## Troubleshooting

### Common Issues
- **Port conflicts**: Ensure ports 8080, 16686, 3000, 9090 are available
- **Terraform auth**: Verify Cribl Cloud credentials in terraform.tfvars
- **Kind cluster**: Use `kind delete cluster --name otel-demo-cribl` to reset

### Getting Help
- Check the individual README files in `terraform/` and `k8s/` directories
- Review Cribl documentation for Stream and Lake configuration
- Examine OpenTelemetry Collector logs for connection issues