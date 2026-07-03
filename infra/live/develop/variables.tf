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
  default     = "latest"
  description = "Container image tag to deploy for api & worker."
}

variable "entra_tenant_id" {
  type        = string
  default     = ""
  description = "Azure Entra tenant ID. Leave empty to disable SSO in this environment."
}

variable "entra_client_id" {
  type        = string
  default     = ""
  description = "Azure Entra application client ID. Leave empty to disable SSO in this environment."
}
