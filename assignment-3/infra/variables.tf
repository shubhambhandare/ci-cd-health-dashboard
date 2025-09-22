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

variable "frontend_image" {
  description = "Frontend container image (e.g. docker.io/user/frontend:tag)"
  type        = string
}

variable "backend_image" {
  description = "Backend container image (e.g. docker.io/user/backend:tag)"
  type        = string
}

variable "frontend_host_port" {
  description = "Host port for the frontend"
  type        = number
  default     = 80
}

variable "frontend_container_port" {
  description = "Container port the frontend listens on"
  type        = number
  default     = 80
}

variable "backend_container_port" {
  description = "Container port the backend listens on"
  type        = number
  default     = 3000
}

variable "frontend_env" {
  description = "Environment variables for the frontend container"
  type        = map(string)
  default     = {}
}

variable "backend_env" {
  description = "Environment variables for the backend container"
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


