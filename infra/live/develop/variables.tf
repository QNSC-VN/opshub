variable "cloudflare_api_token" {
  type        = string
  sensitive   = true
  default     = ""
  description = <<-EOT
    Cloudflare API token (Zone:DNS:Edit + Pages:Edit on qnsc.vn). Supplied via
    TF_VAR_cloudflare_api_token in CI. Leave empty to skip Cloudflare provider auth.
    The zone ID itself is NOT an input here — it is read from the qnsc-infra bootstrap
    via _shared remote state (one source of truth, like kms_key_arn).
  EOT
}

// ── Public identifiers, held in git on purpose ────────────────────────────────
// These are NOT secrets: an Entra tenant/client id appears in the browser's auth
// redirect, and a Cloudflare account id identifies the account without authorising
// anything. The corresponding SECRETS live in Secrets Manager (graph-client-secret)
// and the Cloudflare API token stays a GitHub secret.
//
// They used to arrive as TF_VARs from GitHub Actions variables and secrets, which made
// `Infrastructure · Plan` lie. ENTRA_CLIENT_ID is environment-scoped and the plan job
// has no `environment:` context (adding one would gate every PR behind the production
// reviewer), so it resolved to "" and every plan reported the api and worker task
// definitions "must be replaced"; ENTRA_TENANT_ID was never set at repo level at all,
// so it was empty in the apply too. Reviewers who see phantom replacements on every PR
// stop reading plans — which is exactly when a real one slips through.
//
// In git the value is identical at plan and apply time, so the plan tells the truth and
// the value is reviewable in a diff. Same treatment as rally.

variable "entra_tenant_id" {
  description = "Microsoft Entra tenant id for QNSC (public) — the same directory rally authenticates against."
  type        = string
  default     = "dc0f2078-ac28-4ff2-b21a-d4b28df32361"
}

variable "entra_client_id" {
  description = "Entra application (client) id for opshub develop — a distinct app registration per environment."
  type        = string
  default     = "5a83d82b-34ed-4701-b426-635fd303d875"
}

variable "cloudflare_account_id" {
  description = <<-EOT
    Cloudflare account that owns the Pages project (also a public identifier — it names
    an account without authorising anything).

    Deliberately still EMPTY, unlike the two ids above, and empty means `module.web` is
    skipped entirely. The `opshub-develop-web` Pages project already exists and serves
    traffic (`opshub-develop-web.pages.dev` answers 200) but has never been in this
    state file — the account id was plumbed from a `CLOUDFLARE_ACCOUNT_ID` GitHub secret
    that does not exist, so the count-gated module has always resolved to 0. Filling
    this in would therefore make the apply CREATE a project that is already there and
    fail with "a project with this name already exists".

    Adopting it needs a config-driven `import` block, whose id format is worth proving
    on a plan of its own rather than inside this refactor. Until then the value is "",
    which is exactly what every apply so far has used.
  EOT
  type        = string
  default     = ""
}
