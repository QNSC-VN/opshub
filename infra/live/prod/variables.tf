variable "image_tag" {
  type        = string
  default     = "latest"
  description = <<-EOT
    Container image tag for api/worker/migrator. infra-apply.yml overrides this with
    the v*.*.* tag that triggered the apply, so production runs exactly the release it
    belongs to.

    The default exists so `tofu plan` works without it — the plan job deliberately does
    not pass a tag (it is only known at release time), and a required variable with no
    default would make every prod plan fail instead of merely showing a task-definition
    revision bump.
  EOT
}

variable "cloudflare_api_token" {
  type        = string
  sensitive   = true
  default     = ""
  description = <<-EOT
    Cloudflare API token (Zone:DNS:Edit + Pages:Edit on qnsc.vn). Supplied via
    TF_VAR_cloudflare_api_token in CI. Leave empty to skip Cloudflare provider auth.
    The zone ID itself is NOT an input here — it is read from the qnsc-infra bootstrap
    via _shared remote state.
  EOT
}

// ── Public identifiers, held in git on purpose ────────────────────────────────
// See ../develop/variables.tf for why these are values in git rather than TF_VARs
// from Actions variables: environment-scoped variables are invisible to the plan job,
// so passing them that way made every plan report phantom task-definition
// replacements.

variable "entra_tenant_id" {
  description = "Microsoft Entra tenant id for QNSC (public) — the same directory rally authenticates against."
  type        = string
  default     = "dc0f2078-ac28-4ff2-b21a-d4b28df32361"
}

variable "entra_client_id" {
  description = <<-EOT
    Entra application (client) id for opshub PRODUCTION.

    Empty because the production app registration does not exist yet — develop and
    production need separate registrations (different redirect URIs), and only
    develop's has been created. ENTRA_CLIENT_ID is optional in the API's env schema, so
    the tasks still boot and the Entra-dependent features report themselves disabled.

    GO-LIVE: create the production app registration and put its client id here. Empty
    means nobody can sign in.
  EOT
  type        = string
  default     = ""
}

variable "cloudflare_account_id" {
  description = <<-EOT
    Cloudflare account that owns the Pages project (public identifier).

    Empty, so `module.web` is skipped — matching develop, where the existing
    `opshub-develop-web` project has to be imported before the module can own it. Unlike
    develop, `opshub-prod-web` does NOT exist yet, so filling this in here creates it
    cleanly; it stays empty only so the two environments are wired the same way and one
    follow-up PR turns both on.

    GO-LIVE: this must hold the account id before the SPA can be served in production.
  EOT
  type        = string
  default     = ""
}
