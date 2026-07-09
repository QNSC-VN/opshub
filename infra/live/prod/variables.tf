variable "acm_cert_arn" {
  type        = string
  description = "ACM certificate ARN for the ALB HTTPS listener."
}

variable "prod_tier" {
  type        = string
  default     = "lean"
  description = <<-EOT
    Production reliability tier (Option A cost switch):
    'lean' (~$200/mo) = shared runtime-prod cache node + single-AZ RDS + 1 task/svc.
    'ha'   (~$300/mo) = per-product cache + multi-AZ RDS + 2 tasks/svc + Enhanced Monitoring.
    Only per-product knobs (RDS, cache, task counts) switch here; the shared
    VPC/NAT/ALB/WAF tier is selected in qnsc-infra/live/runtime-prod.
  EOT
  validation {
    condition     = contains(["lean", "ha"], var.prod_tier)
    error_message = "prod_tier must be 'lean' or 'ha'."
  }
}

variable "cloudflare_account_id" {
  type        = string
  default     = ""
  description = "Cloudflare account ID that owns the Pages project (account-level input, not a secret). Pass via TF_VAR_cloudflare_account_id in CI."
}

variable "cloudflare_api_token" {
  type        = string
  default     = ""
  sensitive   = true
  description = "Cloudflare API token (Zone DNS + Pages edit). Pass via TF_VAR_cloudflare_api_token in CI. Empty = skip Cloudflare provider auth."
}


variable "image_tag" {
  type        = string
  description = "Container image tag to deploy for api & worker (pin in prod)."
}

variable "web_domain" {
  type        = string
  default     = "opshub.qnsc.vn"
  description = "Public hostname for the prod web SPA. Used for the Cloudflare Pages custom domain + DNS record (skipped while the Cloudflare zone/account are unset)."
}

variable "entra_tenant_id" {
  type        = string
  description = "Azure Entra tenant ID."
}

variable "entra_client_id" {
  type        = string
  description = "Azure Entra application client ID."
}
