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
    frontend_image           = var.frontend_image
    backend_image            = var.backend_image
    frontend_host_port       = var.frontend_host_port
    frontend_container_port  = var.frontend_container_port
    backend_container_port   = var.backend_container_port
    frontend_env             = var.frontend_env
    backend_env              = var.backend_env
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


