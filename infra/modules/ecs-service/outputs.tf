output "service_name" { value = aws_ecs_service.this.name }
output "task_definition_arn" { value = aws_ecs_task_definition.this.arn }
output "target_group_arn" { value = var.attach_alb ? aws_lb_target_group.this[0].arn : null }
output "task_role_arn" { value = aws_iam_role.task.arn }
