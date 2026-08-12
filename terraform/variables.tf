variable "aws_region" {
  description = "AWS region in which to create the demo instance."
  type        = string
  default     = "us-west-2"
}

variable "aws_profile" {
  description = "Optional AWS CLI profile. Leave empty to use the normal AWS credential chain."
  type        = string
  default     = ""
}

variable "subnet_id" {
  description = "A private subnet with NAT or equivalent outbound access for SSM and Tailscale."
  type        = string
}

variable "instance_profile_name" {
  description = "Existing EC2 instance profile with AmazonSSMManagedInstanceCore."
  type        = string
  default     = "SSMDefault"
}

variable "private_ingress_cidr_blocks" {
  description = "CIDR blocks advertised by the existing Tailscale/VPC network that may reach the demo frontend."
  type        = set(string)
  default     = []
}

variable "ssh_ingress_cidr_blocks" {
  description = "CIDR blocks advertised by the existing Tailscale/VPC network that may reach SSH."
  type        = set(string)
  default     = []
}

variable "ssh_public_key_path" {
  description = "Local public SSH key to authorize for the Ubuntu user."
  type        = string
  default     = "~/.ssh/id_ed25519.pub"
}

variable "instance_type" {
  description = "EC2 instance type. Use a fixed-performance general-purpose instance for Kind and the demo workloads."
  type        = string
  default     = "m7i.2xlarge"
}

variable "root_volume_size_gb" {
  description = "Root EBS volume size in GiB."
  type        = number
  default     = 50
}

variable "repository_url" {
  description = "Git repository to deploy on the instance."
  type        = string
  default     = "https://github.com/criblio/otel-demo-criblcloud.git"
}

variable "repository_ref" {
  description = "Git branch, tag, or commit to deploy."
  type        = string
  default     = "master"
}

variable "cribl_endpoint" {
  description = "Production Cribl Cloud OTLP gRPC endpoint, including its port."
  type        = string
  sensitive   = true
}

variable "cribl_username" {
  description = "Cribl Cloud OTLP basic-auth username."
  type        = string
  sensitive   = true
}

variable "cribl_password" {
  description = "Cribl Cloud OTLP basic-auth password."
  type        = string
  sensitive   = true
}
