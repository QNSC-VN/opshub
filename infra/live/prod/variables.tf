variable "acm_cert_arn" {
  type        = string
  description = "ACM certificate ARN for the ALB HTTPS listener."
}

variable "web_acm_cert_arn" {
  type        = string
  description = "ACM certificate ARN for CloudFront (must be in us-east-1)."
}

variable "image_tag" {
  type        = string
  description = "Container image tag to deploy for api & worker (pin in prod)."
}

variable "entra_tenant_id" {
  type        = string
  description = "Azure Entra tenant ID."
}

variable "entra_client_id" {
  type        = string
  description = "Azure Entra application client ID."
}
