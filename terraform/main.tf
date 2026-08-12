data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"]

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }

  filter {
    name   = "state"
    values = ["available"]
  }

  filter {
    name   = "architecture"
    values = ["x86_64"]
  }
}

data "aws_subnet" "selected" {
  id = var.subnet_id
}

data "aws_iam_instance_profile" "ssm" {
  name = var.instance_profile_name
}

locals {
  ssh_public_key = trimspace(file(pathexpand(var.ssh_public_key_path)))
}

resource "aws_security_group" "instance" {
  name        = "otel-demo-criblcloud"
  description = "Private OpenTelemetry demo access from the Tailscale-routed network"
  vpc_id      = data.aws_subnet.selected.vpc_id

  dynamic "ingress" {
    for_each = var.private_ingress_cidr_blocks

    content {
      description = "OpenTelemetry demo frontend from Tailscale"
      from_port   = 8080
      to_port     = 8080
      protocol    = "tcp"
      cidr_blocks = [ingress.value]
    }
  }

  dynamic "ingress" {
    for_each = var.ssh_ingress_cidr_blocks

    content {
      description = "SSH from Tailscale"
      from_port   = 22
      to_port     = 22
      protocol    = "tcp"
      cidr_blocks = [ingress.value]
    }
  }

  egress {
    description = "Allow package, container, Cribl Cloud, and SSM traffic"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "otel-demo-criblcloud" }
}

resource "aws_instance" "demo" {
  ami                         = data.aws_ami.ubuntu.id
  instance_type               = var.instance_type
  subnet_id                   = var.subnet_id
  associate_public_ip_address = false
  vpc_security_group_ids      = [aws_security_group.instance.id]
  iam_instance_profile        = data.aws_iam_instance_profile.ssm.name

  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required"
  }

  user_data = templatefile("${path.module}/user-data.sh.tftpl", {
    cribl_endpoint = var.cribl_endpoint
    cribl_username = var.cribl_username
    cribl_password = var.cribl_password
    repository_url = var.repository_url
    repository_ref = var.repository_ref
    ssh_public_key = local.ssh_public_key
  })

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.root_volume_size_gb
    encrypted             = true
    delete_on_termination = true
  }

  tags = { Name = "otel-demo-criblcloud" }

  lifecycle {
    ignore_changes = [tags, tags_all]
  }
}
