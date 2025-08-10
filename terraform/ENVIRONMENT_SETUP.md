# Setting Environment Variables for Terraform

This guide covers different methods to set environment variables for Terraform, specifically for Cribl Cloud authentication.

## Method 1: .env File (Recommended)

### Step 1: Create .env file
Create a `.env` file in the terraform directory with your credentials:

```bash
# Cribl Cloud Authentication
# Choose one of the following authentication methods:

# Method 1: OAuth (Client ID + Secret)
CRIBL_CLIENT_ID=your_client_id_here
CRIBL_CLIENT_SECRET=your_client_secret_here
CRIBL_ORGANIZATION_ID=your_organization_id_here
CRIBL_WORKSPACE_ID=your_workspace_id_here

# Method 2: Bearer Token (Alternative)
# CRIBL_BEARER_TOKEN=your_bearer_token_here

# Optional overrides
# CRIBL_SERVER_URL=https://your-cribl-instance.com
# CRIBL_CLOUD_DOMAIN=your-cloud-domain.cribl.cloud
```

### Step 2: Load environment variables
Use the provided script to load variables:

```bash
# Load variables into current shell
source ./load_env.sh

# Or run terraform with variables loaded
./run_terraform.sh init
./run_terraform.sh plan
./run_terraform.sh apply
```

## Method 2: Shell Script with Export

Create a script file (e.g., `set_env.sh`):

```bash
#!/bin/bash
export CRIBL_CLIENT_ID="your_client_id_here"
export CRIBL_CLIENT_SECRET="your_client_secret_here"
export CRIBL_ORGANIZATION_ID="your_organization_id_here"
export CRIBL_WORKSPACE_ID="your_workspace_id_here"
```

Then source it:
```bash
source set_env.sh
terraform init
terraform plan
```

## Method 3: Using direnv (Advanced)

If you have `direnv` installed, create a `.envrc` file:

```bash
# Install direnv
# Ubuntu/Debian: sudo apt install direnv
# macOS: brew install direnv

# Create .envrc file
export CRIBL_CLIENT_ID="your_client_id_here"
export CRIBL_CLIENT_SECRET="your_client_secret_here"
export CRIBL_ORGANIZATION_ID="your_organization_id_here"
export CRIBL_WORKSPACE_ID="your_workspace_id_here"
```

Then allow the directory:
```bash
direnv allow
```

## Method 4: Using a Makefile

Create a `Makefile`:

```makefile
.PHONY: init plan apply

# Load environment variables
include .env
export

init:
	terraform init

plan:
	terraform plan

apply:
	terraform apply
```

Then run:
```bash
make init
make plan
make apply
```

## Method 5: Using Terraform Variables File

For non-sensitive variables, you can use `terraform.tfvars` (already exists):

```hcl
organization_id = "friendly-vaughan-5pyvodc"
workspace_id    = "main"
worker_group_id = "default"
dataset_id      = "otel_demo"
otlp_username   = "cribl_user"
otlp_password   = "OTLPD3m0!!!"
otlp_port       = 20000
```

## Security Best Practices

1. **Never commit sensitive files**: Add `.env`, `set_env.sh`, and `.envrc` to `.gitignore`
2. **Use different files for different environments**: `.env.dev`, `.env.prod`, etc.
3. **Rotate credentials regularly**: Update your Cribl Cloud API credentials periodically
4. **Use least privilege**: Only grant necessary permissions to your API credentials

## Verification

To verify your environment variables are set correctly:

```bash
# Check if variables are loaded
env | grep CRIBL

# Test Terraform provider configuration
terraform init
terraform plan
```

## Troubleshooting

### Common Issues:

1. **Variables not loaded**: Make sure to source the file or use the provided scripts
2. **Permission denied**: Ensure scripts have execute permissions (`chmod +x script.sh`)
3. **Authentication errors**: Verify your Cribl Cloud credentials are correct
4. **File not found**: Ensure you're in the correct directory when running commands

### Debug Commands:

```bash
# Check current environment variables
env | grep CRIBL

# Test provider configuration
terraform providers

# Validate configuration
terraform validate
```
