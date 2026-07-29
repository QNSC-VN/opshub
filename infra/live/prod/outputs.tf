// Re-exported from the stack module. CI's output-sync reads these to publish GitHub
// environment variables (ECS names, migrator subnets, Pages project), so the names
// must match develop's exactly — the same deploy workflow reads both.
output "alb_dns_name" { value = module.stack.alb_dns_name }
output "ecs_cluster_name" { value = module.stack.ecs_cluster_name }
output "ecs_api_service" { value = module.stack.ecs_api_service }
output "ecs_worker_service" { value = module.stack.ecs_worker_service }
output "ecs_migrator_task_def" { value = module.stack.ecs_migrator_task_def }
output "rds_endpoint" { value = module.stack.rds_endpoint }
output "rds_master_secret_arn" { value = module.stack.rds_master_secret_arn }
output "cache_endpoint" { value = module.stack.cache_endpoint }
output "outbox_queue_url" { value = module.stack.outbox_queue_url }
output "secret_arns" { value = module.stack.secret_arns }
output "private_subnet_ids" { value = module.stack.private_subnet_ids }
output "sg_app_id" { value = module.stack.sg_app_id }
output "web_pages_project" { value = module.stack.web_pages_project }
output "web_custom_domain" { value = module.stack.web_custom_domain }
output "web_url" { value = module.stack.web_url }
