# Deploy CI/CD pipeline health dashboard on AWS
_Exported on 9/22/2025 at 15:33:10 GMT+5:30 from Cursor (1.5.5)_

---

**User**



You are an expert **DevOps Engineer** skilled in **Terraform, AWS Cloud, and CI/CD**.
I want you to help me complete this assignment where I need to **deploy our CI/CD Pipeline Health Dashboard application (This assignment2) to AWS using Infrastructure-as-Code (IaC)**. 

#### Goals 

* Use **Terraform** to provision cloud infrastructure on AWS.
* Deploy my **containerized dashboard application** on the provisioned infrastructure.
* Ensure the app is accessible via a **public URL/IP**.
* Follow **AI-native workflow**: generate Terraform code, write scripts, and document usage.

#### Tasks 

1. **Provision Infrastructure with Terraform**

   * Create a **VPC** with public subnet(s).
   * Configure **Internet Gateway + Route Tables** for outbound traffic.
   * Create a **Security Group** allowing SSH (port 22) and HTTP/HTTPS (ports 80, 443).
   * Provision an **EC2 instance** (Ubuntu preferred) to host the app.
   * (Optional) If app requires persistence → provision **RDS PostgreSQL instance**.

2. **Deploy Application**

   * Install **Docker & Docker Compose** on EC2 using Terraform `user_data`. 
   * Pull my containerized app image (from Docker Hub or GitHub Container Registry).
   * Run the app as a Docker container.
   * Output the **public IP or DNS** of the EC2 instance after deployment.

3. **AI-Native Workflow**

   * Help generate Terraform modules and explain them.
 
   * Write documentation (deployment guide, AI prompts used).

#### Deliverables 

* **/infra folder** in GitHub repo containing Terraform scripts.
* **deployment.md** → step-by-step deployment guide:

  * How to run Terraform (`terraform init`, `apply`, etc.)
  * How app is deployed and accessed.
* **prompts.md** → record of prompts used with AI tools.
* A **live running dashboard** accessible via public URL/IP.

#### Constraints 

* Cloud Provider: **AWS**
* Infra as Code: **Terraform**
* App: **Containerized (Docker)**
* No manual console provisioning → only Terraform.

#### Expected AI Output 

1. Terraform scripts for:

   * VPC, subnets, internet gateway, route tables.
   * Security group.
   * EC2 instance with Docker installed.
   * (Optional) RDS PostgreSQL.
   * Outputs → Public IP / DNS.
2. Example deployment script (user\_data or provisioner) to auto-run Docker container.
3. Documentation template (`deployment.md` + `prompts.md`).


Note: Create these files under  assignment-3 folder


---

**Cursor**

I'll create a structured todo list for the Terraform-based AWS deployment, then start adding the Terraform files, user data template, and documentation under `assignment-3`.

I'll scaffold the Terraform infrastructure under `assignment-3/infra` and include a parameterized `user_data` to install Docker and run your container. Then I’ll add `deployment.md` and `prompts.md`.

```plaintext
terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}


```

I'll add the core Terraform files for VPC, variables, security groups, EC2 with user data, and outputs, then mark the VPC task complete and start the security group task.

```plaintext
variable "project_name" {
  description = "Project/name prefix for tagging and resource names"
  type        = string
  default     = "cicd-dashboard"
}

variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "us-east-1"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "public_subnet_cidrs" {
  description = "List of CIDR blocks for public subnets across AZs"
  type        = list(string)
  default     = ["10.0.1.0/24", "10.0.2.0/24"]
}

variable "instance_type" {
  description = "EC2 instance type for the application host"
  type        = string
  default     = "t3.micro"
}

variable "ssh_key_name" {
  description = "Existing AWS key pair name to attach to the instance (optional)"
  type        = string
  default     = ""
}

variable "ssh_public_key" {
  description = "Public key content to create a new keypair if ssh_key_name not provided"
  type        = string
  default     = ""
}

variable "container_image" {
  description = "Container image to run (e.g. docker.io/user/app:tag)"
  type        = string
}

variable "host_http_port" {
  description = "Host port to expose HTTP on"
  type        = number
  default     = 80
}

variable "container_http_port" {
  description = "Container port that serves HTTP"
  type        = number
  default     = 80
}

variable "container_env" {
  description = "Environment variables for the container"
  type        = map(string)
  default     = {}
}

variable "enable_rds" {
  description = "Whether to provision a PostgreSQL RDS instance (optional)"
  type        = bool
  default     = false
}

variable "rds_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t3.micro"
}

variable "rds_username" {
  description = "Master username for RDS"
  type        = string
  default     = "appuser"
}

variable "rds_password" {
  description = "Master password for RDS"
  type        = string
  default     = "ChangeMeStrongPassw0rd!"
  sensitive   = true
}


```

```plaintext
data "aws_availability_zones" "available" {}

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "${var.project_name}-vpc"
  }
}

resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "${var.project_name}-igw"
  }
}

resource "aws_subnet" "public" {
  for_each = { for idx, cidr in var.public_subnet_cidrs : idx => cidr }

  vpc_id                  = aws_vpc.main.id
  cidr_block              = each.value
  availability_zone       = data.aws_availability_zones.available.names[tonumber(each.key)]
  map_public_ip_on_launch = true

  tags = {
    Name = "${var.project_name}-public-${each.key}"
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.igw.id
  }

  tags = {
    Name = "${var.project_name}-public-rt"
  }
}

resource "aws_route_table_association" "public" {
  for_each       = aws_subnet.public
  subnet_id      = each.value.id
  route_table_id = aws_route_table.public.id
}


```

```plaintext
resource "aws_security_group" "app_sg" {
  name        = "${var.project_name}-sg"
  description = "Allow SSH, HTTP, HTTPS"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project_name}-sg"
  }
}


```

```plaintext
#!/bin/bash
set -euo pipefail

exec > >(tee /var/log/user-data.log|logger -t user-data -s 2>/dev/console) 2>&1

apt-get update -y
apt-get install -y ca-certificates curl gnupg lsb-release

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo $VERSION_CODENAME) stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

systemctl enable docker
systemctl start docker

usermod -aG docker ubuntu || true

CONTAINER_IMAGE="${container_image}"
HOST_HTTP_PORT="${host_http_port}"
CONTAINER_HTTP_PORT="${container_http_port}"

docker pull "$CONTAINER_IMAGE"

ENV_ARGS=()
%{ for k, v in container_env ~}
ENV_ARGS+=("-e" "${k}=${v}")
%{ endfor ~}

if docker ps -a --format '{{.Names}}' | grep -q '^app$'; then
  docker rm -f app || true
fi

docker run -d \
  --name app \
  -p ${HOST_HTTP_PORT}:${CONTAINER_HTTP_PORT} \
  "${ENV_ARGS[@]}" \
  "$CONTAINER_IMAGE"


```

```plaintext
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-focal-20.04-amd64-server-*"]
  }
}

resource "aws_key_pair" "generated" {
  count      = length(var.ssh_key_name) == 0 && length(var.ssh_public_key) > 0 ? 1 : 0
  key_name   = "${var.project_name}-key"
  public_key = var.ssh_public_key
}

locals {
  key_name_effective = length(var.ssh_key_name) > 0 ? var.ssh_key_name : (length(var.ssh_public_key) > 0 ? aws_key_pair.generated[0].key_name : null)
}

data "template_file" "user_data" {
  template = file("${path.module}/user_data.sh.tmpl")
  vars = {
    container_image     = var.container_image
    host_http_port      = var.host_http_port
    container_http_port = var.container_http_port
  }
}

data "template_cloudinit_config" "config" {
  gzip          = false
  base64_encode = true

  part {
    content_type = "text/x-shellscript"
    content      = data.template_file.user_data.rendered
  }
}

resource "aws_instance" "app" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = var.instance_type
  subnet_id              = values(aws_subnet.public)[0].id
  vpc_security_group_ids = [aws_security_group.app_sg.id]
  associate_public_ip_address = true
  key_name               = local.key_name_effective

  user_data_base64 = data.template_cloudinit_config.config.rendered

  tags = {
    Name = "${var.project_name}-ec2"
  }
}


```

```plaintext
resource "aws_db_subnet_group" "rds" {
  count      = var.enable_rds ? 1 : 0
  name       = "${var.project_name}-rds-subnets"
  subnet_ids = [for s in aws_subnet.public : s.id]

  tags = {
    Name = "${var.project_name}-rds-subnets"
  }
}

resource "aws_db_instance" "postgres" {
  count                     = var.enable_rds ? 1 : 0
  identifier                = "${var.project_name}-postgres"
  engine                    = "postgres"
  engine_version            = "14"
  instance_class            = var.rds_instance_class
  allocated_storage         = 20
  username                  = var.rds_username
  password                  = var.rds_password
  db_subnet_group_name      = aws_db_subnet_group.rds[0].name
  vpc_security_group_ids    = [aws_security_group.app_sg.id]
  publicly_accessible       = true
  skip_final_snapshot       = true

  tags = {
    Name = "${var.project_name}-postgres"
  }
}

output "rds_endpoint" {
  value       = try(aws_db_instance.postgres[0].address, null)
  description = "RDS endpoint if enabled"
}


```

```plaintext
output "instance_public_ip" {
  description = "Public IP of the EC2 instance"
  value       = aws_instance.app.public_ip
}

output "instance_public_dns" {
  description = "Public DNS of the EC2 instance"
  value       = aws_instance.app.public_dns
}


```

```markdown
*** Begin Patch
*** Add File: assignment-3/deployment.md
+# CI/CD Pipeline Health Dashboard - AWS Terraform Deployment Guide

## Prerequisites
- AWS account with programmatic access (Access key ID/Secret access key)
- Terraform >= 1.5
- An SSH key pair (optional if you want SSH access)
- A container image for the dashboard (Docker Hub/GHCR), e.g. `docker.io/youruser/dashboard:latest`

## Files
- `infra/` Terraform IaC
  - `providers.tf`, `variables.tf`, `vpc.tf`, `security.tf`, `ec2.tf`, `user_data.sh.tmpl`, `rds.tf` (optional), `outputs.tf`

## Configuration
Create `infra/terraform.tfvars` (or set with `-var` flags):
```hcl
project_name       = "cicd-dashboard"
aws_region         = "us-east-1"
container_image    = "docker.io/youruser/dashboard:latest"
ssh_key_name       = "your-existing-keypair-name" # or leave empty and use ssh_public_key
# ssh_public_key   = "ssh-ed25519 AAAA... you@host"
# enable_rds       = true
# rds_username     = "appuser"
# rds_password     = "StrongPassw0rd!"
# container_env = {
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

## Outputs
After apply, note:
- `instance_public_ip`
- `instance_public_dns`

Access the app at:
- `http://<instance_public_ip>/` or `http://<instance_public_dns>/`

## SSH (optional)
```bash
ssh -i /path/to/your.pem ubuntu@<instance_public_ip>
```

## Update/Destroy
- Update variables and `terraform apply` again.
- Destroy all resources:
```bash
terraform destroy -auto-approve
```

## How it works
- VPC with public subnets, IGW, and route table for egress.
- Security group allows SSH(22), HTTP(80), HTTPS(443).
- EC2 Ubuntu VM boots with cloud-init user data that installs Docker and runs your container, publishing port 80.
- Optional: RDS PostgreSQL if `enable_rds = true`.

*** End Patch
```

I created the core Terraform scaffolding and will now fix the EC2 user_data templating to avoid extra providers, then add the deployment and prompts docs.

```plaintext
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-focal-20.04-amd64-server-*"]
  }
}

resource "aws_key_pair" "generated" {
  count      = length(var.ssh_key_name) == 0 && length(var.ssh_public_key) > 0 ? 1 : 0
  key_name   = "${var.project_name}-key"
  public_key = var.ssh_public_key
}

locals {
  key_name_effective = length(var.ssh_key_name) > 0 ? var.ssh_key_name : (length(var.ssh_public_key) > 0 ? aws_key_pair.generated[0].key_name : null)
}

locals {
  user_data_rendered = templatefile("${path.module}/user_data.sh.tmpl", {
    container_image     = var.container_image
    host_http_port      = var.host_http_port
    container_http_port = var.container_http_port
    container_env       = var.container_env
  })
}

resource "aws_instance" "app" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = var.instance_type
  subnet_id              = values(aws_subnet.public)[0].id
  vpc_security_group_ids = [aws_security_group.app_sg.id]
  associate_public_ip_address = true
  key_name               = local.key_name_effective

  user_data = local.user_data_rendered

  tags = {
    Name = "${var.project_name}-ec2"
  }
}



```

```plaintext
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



```

```markdown
*** Begin Patch
*** Add File: assignment-3/infra/README.md
+# Terraform for CI/CD Dashboard

See `../deployment.md` for end-to-end instructions. This folder contains the Terraform IaC to provision AWS resources and deploy the containerized app to EC2 with Docker.
*** End Patch
```

```markdown
*** Begin Patch
*** Add File: assignment-3/deployment.md
+# CI/CD Pipeline Health Dashboard - AWS Terraform Deployment Guide

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
container_image    = "docker.io/youruser/dashboard:latest"
ssh_key_name       = "your-existing-keypair-name" # or leave empty and use ssh_public_key
# ssh_public_key   = "ssh-ed25519 AAAA... you@host"
# enable_rds       = true
# rds_username     = "appuser"
# rds_password     = "StrongPassw0rd!"
# container_env = {
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
Open `http_url` in your browser.

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
*** End Patch
```

Creating the missing documentation and example vars, then I’ll reconcile the todo list to mark completed items.

```markdown
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
container_image    = "docker.io/youruser/dashboard:latest"
ssh_key_name       = "your-existing-keypair-name" # or leave empty and use ssh_public_key
# ssh_public_key   = "ssh-ed25519 AAAA... you@host"
# enable_rds       = true
# rds_username     = "appuser"
# rds_password     = "StrongPassw0rd!"
# container_env = {
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
Open `http_url` in your browser.

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
```

```markdown
# AI Prompts Log (assignment-3)

Record prompts used with AI tools for this deployment.

## Prompts
- Goal and requirements for Terraform AWS deployment
- Generate Terraform VPC, subnets, IGW, routes
- Create Security Group for SSH/HTTP/HTTPS
- Provision EC2 with user_data installing Docker and running container
- Add optional RDS PostgreSQL
- Write deployment.md instructions

## Notes
- Include any adjustments or clarifications made during iteration.
```

```plaintext
project_name       = "cicd-dashboard"
aws_region         = "us-east-1"
container_image    = "docker.io/youruser/dashboard:latest"

# Provide one of the following for SSH access
# ssh_key_name     = "your-existing-keypair-name"
# OR
# ssh_public_key   = "ssh-ed25519 AAAA... you@host"

# Optional RDS
# enable_rds       = true
# rds_instance_class = "db.t3.micro"
# rds_username     = "appuser"
# rds_password     = "ChangeMeStrongPassw0rd!"

# Optional container environment
# container_env = {
#   NODE_ENV = "production"
# }
```

```markdown
# Terraform for CI/CD Dashboard

See `../deployment.md` for end-to-end instructions. This folder contains the Terraform IaC to provision AWS resources and deploy the containerized app to EC2 with Docker.
```

I updated Terraform files to provision VPC, networking, security group, EC2 with Docker via user data, optional RDS, and outputs. I’ll fix a small robustness issue in the subnet AZ selection and then mark EC2 and user data tasks complete.

```plaintext
data "aws_availability_zones" "available" {}

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "${var.project_name}-vpc"
  }
}

resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "${var.project_name}-igw"
  }
}

resource "aws_subnet" "public" {
  for_each = { for idx, cidr in var.public_subnet_cidrs : tostring(idx) => cidr }

  vpc_id                  = aws_vpc.main.id
  cidr_block              = each.value
  availability_zone       = data.aws_availability_zones.available.names[tonumber(each.key)]
  map_public_ip_on_launch = true

  tags = {
    Name = "${var.project_name}-public-${each.key}"
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.igw.id
  }

  tags = {
    Name = "${var.project_name}-public-rt"
  }
}

resource "aws_route_table_association" "public" {
  for_each       = aws_subnet.public
  subnet_id      = each.value.id
  route_table_id = aws_route_table.public.id
}



```

- I created `assignment-3/infra` with Terraform for AWS: VPC, public subnets, IGW, route table, security group, EC2 (Ubuntu) with Docker via user_data, optional RDS toggle, and outputs for public IP/DNS/URL.
- I added `assignment-3/deployment.md`, `assignment-3/prompts.md`, and `assignment-3/infra/terraform.tfvars.example`.

What you need to do:
- Put your image in `container_image` in `assignment-3/infra/terraform.tfvars` (or pass via -var).
- Optionally set `ssh_key_name` or `ssh_public_key` for SSH.
- Deploy:
```bash
cd assignment-3/infra
terraform init
terraform apply -auto-approve
```
- Open the output `http_url`.

Notes:
- `user_data` installs Docker and runs your container on port 80.
- RDS is optional via `enable_rds`.

```shellscript
cd assignment-3/infra
terraform init
terraform apply -auto-approve
```

