# CI/CD Pipeline Health Dashboard - AWS Terraform Deployment Guide

This guide deploys the dashboard on AWS EC2 using Terraform.

## Prerequisites
- AWS account with programmatic access (Access key ID/Secret access key)
- Terraform >= 1.5
- An SSH key pair (optional if you want SSH access)
- A container image for the dashboard (Docker Hub/GHCR), e.g. `docker.io/youruser/dashboard:latest`

## Files
- `assignment-3/infra/` Terraform IaC
  - `providers.tf`, `variables.tf`, `vpc.tf`, `security.tf`, `ec2.tf`, `user_data.sh.tmpl`, `rds.tf` (optional), `outputs.tf`

## Configure variables
Create `assignment-3/infra/terraform.tfvars` (or pass with `-var`):
```hcl
project_name       = "cicd-dashboard"
aws_region         = "us-east-1"

# Images
frontend_image     = "docker.io/youruser/dashboard-frontend:latest"
backend_image      = "docker.io/youruser/dashboard-backend:latest"

# Ports
frontend_host_port      = 80
frontend_container_port = 80
backend_container_port  = 3000

ssh_key_name       = "your-existing-keypair-name" # or leave empty and use ssh_public_key
# ssh_public_key   = "ssh-ed25519 AAAA... you@host"
# enable_rds       = true
# rds_username     = "appuser"
# rds_password     = "StrongPassw0rd!"

# Optional env
# frontend_env = {
#   VITE_API_BASE_URL = "http://localhost:3000"
# }
# backend_env = {
#   NODE_ENV = "production"
# }
```

## Deploy
```bash
cd assignment-3/infra
terraform init
terraform plan -out tfplan
terraform apply -auto-approve tfplan
```

## Outputs and access
After apply, note `instance_public_ip`, `instance_public_dns`, and `http_url`.
Open `http_url` in your browser (frontend on port 80). Ensure your frontend’s API base URL points to `http://<instance_public_ip>:3000` or similar.

## SSH (optional)
```bash
ssh -i /path/to/your.pem ubuntu@<instance_public_ip>
```

## Update and destroy
- Update variables and `terraform apply` again.
- Destroy all resources:
```bash
terraform destroy -auto-approve
```

## How it works
- VPC with public subnets, IGW, and route table for egress.
- Security group allows SSH(22), HTTP(80), HTTPS(443).
- EC2 Ubuntu boots and, via user data, installs Docker and runs your container on port 80.
- Optional: RDS PostgreSQL if `enable_rds = true`.
