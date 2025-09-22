output "instance_public_ip" {
  description = "Public IP of the EC2 instance"
  value       = aws_instance.app.public_ip
}

output "instance_public_dns" {
  description = "Public DNS of the EC2 instance"
  value       = aws_instance.app.public_dns
}

output "http_url" {
  description = "HTTP URL to access the app"
  value       = "http://${aws_instance.app.public_dns}"
}


