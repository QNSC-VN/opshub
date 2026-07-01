variable "name" { type = string }
variable "region" { type = string }
variable "azs" { type = list(string) }
variable "vpc_cidr" { type = string }
variable "public_subnet_cidrs" { type = list(string) }
variable "private_subnet_cidrs" { type = list(string) }
variable "data_subnet_cidrs" { type = list(string) }
variable "multi_az_nat" {
  type    = bool
  default = false
}
variable "app_port" {
  type    = number
  default = 3000
}
variable "tags" {
  type    = map(string)
  default = {}
}
variable "enable_flow_logs" {
  type        = bool
  default     = true
  description = "Enable VPC flow logs to CloudWatch (SOC 2 CC7.2 — network monitoring)"
}
variable "flow_log_retention_days" {
  type        = number
  default     = 90
  description = "CloudWatch log retention for VPC flow logs (90 days = SOC 2 minimum)"
}
variable "alb_ingress_cidrs" {
  type        = list(string)
  default     = ["0.0.0.0/0"]
  description = "CIDRs allowed to reach ALB on 443/80. Set to Cloudflare IP ranges in prod when using orange-cloud proxy."
}
