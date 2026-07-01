output "alb_dns_name" { value = aws_lb.this.dns_name }
output "rds_endpoint" { value = module.rds.endpoint }
output "rds_master_secret_arn" { value = module.rds.master_secret_arn }
output "outbox_queue_url" { value = module.messaging.outbox_queue_url }
output "cluster_name" { value = module.ecs_cluster.cluster_name }
