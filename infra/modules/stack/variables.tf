// The product stack's input surface.
//
// Everything an environment CHOOSES is here; everything DERIVED from those choices
// lives in main.tf's locals. That split is the point of the module: develop and prod
// can no longer differ in structure, only in the values below, so a change made for
// one environment is automatically made for both.
//
// Defaults lean SAFE rather than cheap — a forgotten input should err toward
// production behaviour (no Spot, longer retention, no force_destroy), because the
// failure mode of a too-cheap production is worse than a too-careful develop.

// ── Identity ────────────────────────────────────────────────────────────────────

variable "product" {
  description = "Product slug. Drives resource names, ECR repos and secret prefixes."
  type        = string
}

variable "env" {
  description = "Environment name as it appears in tags and secret prefixes (e.g. develop, production)."
  type        = string
}

variable "env_slug" {
  description = <<-EOT
    Short environment token used in RESOURCE NAMES (`<product>-<env_slug>`).
    Deliberately separate from `env`: production resources are named `opshub-prod`
    while the environment is called `production`, and renaming them would force
    replacement of the cluster, the RDS instance and every log group.
  EOT
  type        = string
}

variable "region" {
  type = string
}

// ── Networking / DNS ────────────────────────────────────────────────────────────

variable "app_domain" {
  description = "Public SPA hostname. Also drives CORS_ORIGINS and APP_URL."
  type        = string
}

variable "api_domain" {
  description = "Public API hostname, used for the ALB host-header rule and the API's Cloudflare record."
  type        = string
}

variable "web_record" {
  description = "Cloudflare CNAME label for the SPA (e.g. `opshub-dev`, `opshub`)."
  type        = string
}

variable "api_record" {
  description = "Cloudflare CNAME label for the API (e.g. `opshub-api-dev`, `opshub-api`)."
  type        = string
}

// ── Remote state ────────────────────────────────────────────────────────────────

variable "shared_state_key" {
  description = "State key of the product's _shared stack (ECR, KMS, Cloudflare zone)."
  type        = string
}

variable "runtime_state_key" {
  description = "State key of the platform runtime stack for this environment (VPC, ALB, SGs)."
  type        = string
}

// ── Application ─────────────────────────────────────────────────────────────────

variable "image_tag" {
  description = "Container image tag for api/worker/migrator. `latest` is acceptable in develop; production pins the release tag that triggered the apply."
  type        = string
  default     = "latest"
}

variable "entra_tenant_id" {
  description = "Microsoft Entra tenant id (public identifier)."
  type        = string
}

variable "entra_client_id" {
  description = <<-EOT
    Entra application (client) id for THIS environment — a distinct app registration
    per environment, because the redirect URIs differ.

    Empty leaves SSO dormant: `ENTRA_CLIENT_ID` is optional in the API's env schema,
    so the task still boots and the Entra-dependent features self-disable rather than
    crash-looping. That is the state production is in until its app registration
    exists.
  EOT
  type        = string
}

variable "graph_client_secret_set" {
  description = <<-EOT
    Inject `graph-client-secret` into api and worker.

    OFF by default, and the default is the point. ECS cannot inject a Secrets Manager
    secret that holds no value — the task dies before the app runs with
    "ResourceInitializationError ... can't find the specified secret value for staging
    label: AWSCURRENT". So wiring an OPTIONAL integration unconditionally makes it
    mandatory in the worst possible way: this single empty secret is why no opshub task
    has ever started, even though the app treats the Graph features as self-disabling.

    While this is false the Graph-backed surfaces (compliance sync, security posture,
    workforce provisioning, PIM) report themselves disabled and everything else runs.
    Populate the secret in Secrets Manager first, then flip this — the same two-step
    shape rally uses for credentials it cannot generate.
  EOT
  type        = bool
  default     = false
}

variable "cache" {
  description = <<-EOT
    Cache sizing. Encryption is NOT an option here: the module always enables KMS at
    rest and TLS in transit, so both environments get the same posture and the URL is
    always `rediss://`.

    `serverless` mode floors at roughly $90/month, so `node` is the default for both
    environments; a single cache.t4g.micro is about $12/month.
  EOT
  type = object({
    mode      = optional(string, "node")
    node_type = optional(string, "cache.t4g.micro")
  })
  default = {}
}

// ── Per-environment tuning ──────────────────────────────────────────────────────

variable "log_retention_days" {
  description = "CloudWatch log retention for api, worker and migrator. Production keeps 90 for SOC 2."
  type        = number
  default     = 90
}

variable "secrets_recovery_window_days" {
  description = <<-EOT
    Secrets Manager recovery window. 0 in develop so a destroy+redeploy cycle does
    not hit "secret scheduled for deletion"; production keeps a real window so a
    mistaken destroy is recoverable.
  EOT
  type        = number
  default     = 30
}

variable "container_insights" {
  description = <<-EOT
    ECS Container Insights mode: "enhanced", "enabled" or "disabled".

    Stated here rather than inherited, because the ecs-cluster module defaults to
    "enhanced" and that default is expensive: enhanced adds per-task and per-container
    metrics that CloudWatch bills as CUSTOM metrics at $0.07 each, and the count grows
    with task churn rather than with traffic. Four clusters silently on that default
    produced 606 metric-months (~$42) on the July 2026 bill — this stack's cluster was
    one of them, because it never passed the variable.

    "disabled" because nothing in this product reads the ECS/ContainerInsights
    namespace: autoscaling targets read AWS/ECS, which is free and published either
    way, and application telemetry goes to OTLP rather than CloudWatch.

    Raise an environment to "enhanced" while debugging a per-container resource
    problem, then put it back.
  EOT
  type        = string
  default     = "disabled"

  validation {
    condition     = contains(["enhanced", "enabled", "disabled"], var.container_insights)
    error_message = "container_insights must be enhanced, enabled, or disabled."
  }
}

variable "rds" {
  description = "Database sizing and durability. No defaults for storage or protection — both callers state them explicitly, so neither is production-critical by accident."
  type = object({
    instance_class           = string
    allocated_storage_gb     = number
    max_allocated_storage_gb = number
    multi_az                 = bool
    deletion_protection      = bool
    backup_retention_days    = number
    monitoring_interval      = optional(number, 0)
  })
}

variable "api" {
  description = <<-EOT
    API service sizing and scaling.

    The autoscaling targets repeat the ecs-service module's own defaults (65/75) rather
    than defaulting to null. `null` is NOT "use the module's default" for a nested
    optional attribute — it is passed through as null, and
    `target_tracking_scaling_policy_configuration.target_value` is a required argument,
    so the plan fails outright. Restating the numbers keeps every environment's target
    explicit and reviewable.
  EOT
  type = object({
    cpu               = number
    memory            = number
    max_count         = number
    use_spot          = optional(bool, false)
    cpu_target_pct    = optional(number, 65)
    memory_target_pct = optional(number, 75)
  })
}

variable "worker" {
  description = "Worker service sizing and scaling."
  type = object({
    cpu       = number
    memory    = number
    max_count = number
    use_spot  = optional(bool, false)
  })
}

variable "uploads" {
  description = <<-EOT
    The S3 upload bucket's environment-specific behaviour.

    `force_destroy` defaults to FALSE: an environment that wants its uploads deleted
    along with the bucket has to say so. `extra_cors_origins` is additive to the app's
    own origin (which is always allowed) and exists for local development against a
    deployed bucket — never populate it in production.
  EOT
  type = object({
    force_destroy      = optional(bool, false)
    extra_cors_origins = optional(list(string), [])
  })
  default = {}
}

variable "cloudflare_account_id" {
  description = "Cloudflare account that owns the Pages project (public identifier). Empty skips the Pages project entirely."
  type        = string
  default     = ""
}
