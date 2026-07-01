variable "service_name" { type = string }
variable "cluster_name" { type = string }
variable "cluster_arn" { type = string }
variable "image_uri" { type = string }
variable "region" {
  type    = string
  default = "ap-southeast-1"
}

variable "cpu" {
  type    = number
  default = 512
}
variable "memory" {
  type    = number
  default = 1024
}
variable "container_port" {
  type    = number
  default = 3000
}

variable "vpc_id" { type = string }
variable "subnet_ids" { type = list(string) }
variable "security_group_id" { type = string }

variable "desired_count" {
  type    = number
  default = 1
}
variable "min_count" {
  type    = number
  default = 1
}
variable "max_count" {
  type    = number
  default = 3
}
variable "cpu_target_pct" {
  type        = number
  default     = 70
  description = "ECS CPU auto-scaling target %. Set 60 in prod for tighter scaling."
}
variable "memory_target_pct" {
  type        = number
  default     = 80
  description = "ECS memory auto-scaling target %."
}
variable "log_retention_days" {
  type        = number
  default     = 30
  description = "CloudWatch log retention days. Set 90 in prod for SOC 2 compliance."
}

variable "attach_alb" {
  type    = bool
  default = false
}
variable "alb_listener_arn" {
  type    = string
  default = null
}
variable "alb_priority" {
  type    = number
  default = 100
}
variable "alb_path_patterns" {
  type    = list(string)
  default = ["/*"]
}
variable "health_check_path" {
  type    = string
  default = "/v1/healthz"
}
variable "health_check_command" {
  type    = string
  default = null
}

variable "secret_arns" {
  type    = list(string)
  default = []
}
variable "secrets" {
  type    = list(object({ name = string, secret_arn = string }))
  default = []
}
variable "environment_vars" {
  type    = list(object({ name = string, value = string }))
  default = []
}

variable "sqs_queue_arns" {
  type    = list(string)
  default = []
}
variable "sns_topic_arns" {
  type    = list(string)
  default = []
}
variable "s3_bucket_arns" {
  type        = list(string)
  default     = []
  description = "S3 bucket ARNs the task role can read/write (e.g. file upload bucket)."
}

variable "tags" {
  type    = map(string)
  default = {}
}
