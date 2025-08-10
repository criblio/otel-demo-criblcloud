#!/bin/bash
# Script to run Terraform with environment variables loaded from .env

# Load environment variables
source ./load_env.sh

# Run terraform command
terraform "$@"
