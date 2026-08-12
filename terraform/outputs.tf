output "instance_id" {
  description = "Use this ID for SSM sessions and port forwarding."
  value       = aws_instance.demo.id
}

output "instance_private_ip" {
  description = "VPC private IP reachable through the existing Tailscale-routed network."
  value       = aws_instance.demo.private_ip
}

output "ssh_command" {
  description = "SSH to the Ubuntu user over the existing Tailscale-routed network."
  value       = "ssh ubuntu@${aws_instance.demo.private_ip}"
}

output "ssm_port_forward_command" {
  description = "Forward the demo frontend to localhost:8080."
  value       = "aws ssm start-session ${var.aws_profile != "" ? "--profile ${var.aws_profile} " : ""}--region ${var.aws_region} --target ${aws_instance.demo.id} --document-name AWS-StartPortForwardingSession --parameters '{\"portNumber\":[\"8080\"],\"localPortNumber\":[\"8080\"]}'"
}
