output "endpoint" { value = aws_db_instance.this.endpoint }
output "address" { value = aws_db_instance.this.address }
output "db_name" { value = aws_db_instance.this.db_name }
output "master_secret_arn" { value = aws_db_instance.this.master_user_secret[0].secret_arn }
