# OpenTelemetry Demo with Cribl Search

Run the [OpenTelemetry Demo](https://github.com/open-telemetry/opentelemetry-demo) application locally and send telemetry (traces, metrics, logs) to Cribl Search.

## Architecture

```
OpenTelemetry Demo (Kind Kubernetes cluster)
    └── OpenTelemetry Collector
         ├→ Cribl Search (OTLP gRPC with TLS + Basic Auth)
         └→ Local backends (Jaeger, Grafana, Prometheus)
```

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/)
- [kind](https://kind.sigs.k8s.io/docs/user/quick-start/#installation)
- [kubectl](https://kubernetes.io/docs/tasks/tools/)
- [Helm](https://helm.sh/docs/intro/install/) (>= 3.0)
- A Cribl Search environment with an OTLP source configured

## Quick Start

1. **Configure your Cribl Search connection:**
   ```bash
   cp .env.example .env
   # Edit .env with your endpoint and credentials
   ```

2. **Run the setup:**
   ```bash
   ./k8s/scripts/setup-demo.sh
   ```

3. **Access the demo:**

   | Service | URL |
   |---------|-----|
   | Demo Frontend | http://localhost:8080 |
   | Jaeger UI | http://localhost:16686 |
   | Grafana | http://localhost:3000 |
   | Prometheus | http://localhost:9090 |

## Configuration

The `.env` file requires three values:

| Variable | Description | Example |
|----------|-------------|---------|
| `CRIBL_ENDPOINT` | OTLP endpoint for your Cribl Search environment | `default.main.my-org.cribl.cloud:20000` |
| `CRIBL_USERNAME` | Basic auth username | `cribl_user` |
| `CRIBL_PASSWORD` | Basic auth password | `my_password` |

## Monitoring

```bash
# Check pod status
kubectl get pods -n otel-demo

# View collector logs
kubectl logs -l app.kubernetes.io/name=opentelemetry-collector -n otel-demo
```

## Cleanup

```bash
kind delete cluster --name otel-demo-cribl
```

## AWS Provisioning

The `terraform/` directory contains an example that creates an Ubuntu EC2 instance,
installs Docker, Kind, kubectl, and Helm, then runs the same demo setup against a
Cribl Cloud OTLP endpoint. The Test-account example uses a private subnet with NAT
and the existing Tailscale-routed private network, reuses the account's `SSMDefault`
instance profile, and does not assign a public IP or expose SSH/dashboard ports
publicly.

The deployment pins the OpenTelemetry Demo Helm chart to `0.40.9`, whose
`appVersion` is `2.2.0`, to avoid the breaking changes introduced in `3.0.0`.

Prerequisites:

- Terraform >= 1.5
- AWS CLI credentials with permission to create EC2 and security-group resources
- AWS Systems Manager Session Manager plugin
- A private subnet with outbound internet access through NAT
- Tailscale access to the CIDR advertised for the Test-account VPC
- A local SSH public key, defaulting to `~/.ssh/id_ed25519.pub`

Configure local variables without committing credentials:

```bash
cp terraform/terraform.tfvars.example terraform/terraform.tfvars
# Edit terraform/terraform.tfvars with the Cribl endpoint and credentials
aws sso login --profile test
terraform -chdir=terraform init
terraform -chdir=terraform plan
terraform -chdir=terraform apply
```

The Cribl credentials are sensitive Terraform variables, but Terraform state and
EC2 user data can still contain them. Keep the state in a protected backend before
using this beyond a personal test environment. Terraform does not automatically
create the Cribl Cloud OTLP source; configure that source and its credentials first.
With the default local backend, state is stored at `terraform/terraform.tfstate`
and is excluded by `.gitignore`.

After the private instance reports healthy in Systems Manager, access the frontend
over the existing Tailscale route using the instance's private IP:

```bash
terraform -chdir=terraform output -raw instance_private_ip
```

Then open `http://<private-ip>:8080` from a device connected to the same tailnet.

SSH access is enabled only from the Tailscale-routed CIDR. Terraform installs the
local public key for the `ubuntu` user; the private key never leaves this machine:

```bash
terraform -chdir=terraform output -raw ssh_command
ssh ubuntu@<private-ip>
```

As an alternative, forward the frontend locally:

```bash
terraform -chdir=terraform output -raw ssm_port_forward_command | sh
```

Then open http://localhost:8080. Destroy the instance and its supporting resources with:

```bash
terraform -chdir=terraform destroy
```
