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


