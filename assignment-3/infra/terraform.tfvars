project_name       = "cicd-dashboard"
aws_region         = "us-east-1"

# Frontend and backend images
frontend_image     = "docker.io/shubhambhandare/cicd-frontend:v1"
backend_image      = "docker.io/shubhambhandare/cicd-backend:v1"

# Port mappings
frontend_host_port      = 80
frontend_container_port = 80
backend_container_port  = 3000

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
# frontend_env = {
#   VITE_API_BASE_URL = "http://localhost:3000"
# }
# backend_env = {
#   NODE_ENV = "production"
# }
