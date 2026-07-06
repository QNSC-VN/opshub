variable "acm_cert_arn" {
  type        = string
  description = "ACM certificate ARN for the ALB HTTPS listener."
}

variable "cloudflare_account_id" {
  type        = string
  default     = ""
  description = <<-EOT
    Cloudflare account ID that owns the Pages project (account-level input, not
    a secret). Pass via TF_VAR_cloudflare_account_id in CI. Leave empty to skip
    the web module while the Cloudflare account is not yet wired.
  EOT
}

variable "cloudflare_api_token" {
  type        = string
  default     = ""
  sensitive   = true
  description = "Cloudflare API token (Zone DNS + Pages edit). Pass via TF_VAR_cloudflare_api_token in CI. Empty = skip Cloudflare provider auth."
}

# DEPRECATED: web now serves via Cloudflare Pages (no CloudFront ACM cert).
# Retained only so existing CI env (TF_VAR_web_acm_cert_arn) doesn't error;
# remove after the Pages migration is fully rolled out.
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
