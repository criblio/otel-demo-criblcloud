terraform {
  required_version = ">= 1.6.0"
  required_providers {
    criblio = {
      source  = "criblio/criblio"
      version = "~> 1.4.10"
    }
  }
}

provider "criblio" {
  # Credentials pulled from environment variables:
  #   CRIBL_CLIENT_ID, CRIBL_CLIENT_SECRET, CRIBL_ORGANIZATION_ID, CRIBL_WORKSPACE_ID
  # or CRIBL_BEARER_TOKEN
  # Optional overrides: server_url, cloud_domain, workspace_name, group_name
}
