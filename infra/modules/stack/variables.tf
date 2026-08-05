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

variable "entra_client_secret_set" {
  description = <<-EOT
    Inject `entra-client-secret` into api and worker, enabling the BFF's server-side
    code exchange.

    OFF by default for the same mechanical reason as `graph_client_secret_set`: ECS
    cannot inject a Secrets Manager secret that holds no value — the task dies before the
    app runs — so wiring a credential that has not been minted yet takes the whole
    environment down.

    This one cannot be generated on this side. It is a confidential-client secret created
    on the Entra app registration, so the order is: create the secret in Entra, put it in
    Secrets Manager, then flip this.

    While it is false the SPA can still reach `POST /v1/bff/login` and receive an
    authorize URL; the callback is what fails, closed, with a generic 401. Everything
    that does not depend on interactive login is unaffected.
  EOT
  type        = bool
  default     = false
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

variable "tunnel_enabled" {
  description = <<-EOT
    Serve this environment's api through a Cloudflare Tunnel sidecar instead of the
    shared ALB.

    Not an optimisation any more — a requirement. The shared ALBs in
    qnsc-infra/live/runtime-{dev,prod} were deleted once both products moved to tunnels,
    so `runtime.outputs.https_listener_arn` is null and `attach_alb = true` has nothing
    to attach to. Bringing an ALB back is `enable_alb = true` in that layer, at $18.40/mo
    plus $3.65 per enabled AZ.

    The saving is real but secondary: every request already arrives through Cloudflare
    (the SPA is a Pages project whose Function proxies /v1/* to the API), so the load
    balancer was a second TLS termination inside an already-proxied path.

    Turning this ON turns OFF the ALB target-group attachment, because a tunnelled task
    must not also be an ALB target — the target group would health-check a port the
    connector owns, and traffic could arrive by two paths with different TLS termination.

    REQUIRES `tunnel-token` to hold a value and `tunnel_id` to be set. Absent the token,
    no sidecar is produced and the api has NO ingress at all, so those move together.

    WHAT IS GIVEN UP: ALB access logs, the option of an origin-side AWS WAF, and
    per-target-group CloudWatch alarms. Cloudflare's own analytics and a synthetic probe
    have to replace them before production relies on this.
  EOT
  type        = bool
  default     = false
}

variable "tunnel_id" {
  description = <<-EOT
    Cloudflare Tunnel UUID, used to build the CNAME target `<id>.cfargotunnel.com`.

    Not discoverable from the connector token — a tunnel and its token are separate reads
    on the Cloudflare API — so it is passed in rather than derived. The tunnel itself is
    created out of band, because Terraform cannot mint a token without also owning the
    tunnel's lifecycle, and destroying a tunnel to recreate it invalidates every deployed
    connector.
  EOT
  type        = string
  default     = ""

  validation {
    condition     = !var.tunnel_enabled || var.tunnel_id != ""
    error_message = "tunnel_enabled = true requires tunnel_id — the CNAME has no target without it."
  }
}

variable "idle_schedule" {
  description = <<-EOT
    Cron/rate expression for an EventBridge Scheduler that IDLES this environment: stops
    the RDS instance AND scales both services to zero. Null (the default) creates no
    schedule, no role and no policy.

    Both halves matter. Stopping only the database leaves Fargate tasks running against
    an instance they cannot reach — still billed, unable to serve, and invisible, because
    `/v1/healthz` answers 200 regardless of whether Postgres is reachable.

    REQUIRED for any environment that is deliberately idle, because AWS FORCE-STARTS a
    stopped RDS instance after seven days. Without a recurring re-stop the instance
    quietly comes back and the saving disappears with nothing reporting it.

    Expression is evaluated in Asia/Ho_Chi_Minh. Every Sunday 01:00 local — comfortably
    inside the 7-day window:

        cron(0 1 ? * SUN *)

    Stopping an already-stopped instance fails with InvalidDBInstanceState, which is the
    DESIRED state rather than an error, so the target takes no retries and no DLQ.
  EOT
  type        = string
  default     = null
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
    # Create the cache node at all. False is for an environment that is deliberately
    # idle: ElastiCache cannot be stopped, only deleted, so the node is the one component
    # of an idled environment that keeps billing (~$12/mo). Requires min_count = 0 on
    # BOTH services — the `check` block in main.tf enforces it, because a task without a
    # reachable cache does not fail loudly.
    enabled   = optional(bool, true)
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
    cpu    = number
    memory = number
    # The FLOOR, and also the desired count at apply time. 0 parks the environment: it is
    # what makes `idle_schedule` hold, because Application Auto Scaling restores a service
    # within minutes of a scale-down when the floor is 1.
    min_count         = optional(number, 1)
    max_count         = number
    use_spot          = optional(bool, false)
    cpu_target_pct    = optional(number, 65)
    memory_target_pct = optional(number, 75)
    # Off for a schedule-driven environment, where autoscaling would fight
    # `idle_schedule` by restoring the task it just scaled to zero. On by default,
    # because a load-driven environment that silently stopped scaling is worse.
    enable_autoscaling = optional(bool, true)
  })
}

variable "worker" {
  description = "Worker service sizing and scaling."
  type = object({
    cpu                = number
    memory             = number
    min_count          = optional(number, 1)
    max_count          = number
    use_spot           = optional(bool, false)
    enable_autoscaling = optional(bool, true)
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
