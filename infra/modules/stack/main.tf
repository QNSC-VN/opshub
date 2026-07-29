// The opshub product stack — one module, both environments.
//
// develop and production used to be two 370-line files that were 95% identical, so
// every change had to be made twice and the differences that mattered were invisible
// among the ones that did not. Everything structural now lives here; the callers in
// ../../live/<env> hold only the values that genuinely differ.
//
// This module deliberately does NOT own the VPC, the NAT gateway, the ALB or the WAF.
// Those are shared per-environment and live once in qnsc-infra/live/runtime-<env>;
// this stack consumes them via remote state. Per-product resources — RDS, cache,
// Fargate services, queues, the upload bucket — are here.

data "aws_caller_identity" "current" {}

# ── Read shared layer outputs (ECR URLs, KMS ARN, Cloudflare zone) ────────────
# _shared owns the ECR repos and the OIDC roles, and re-exports platform-level
# outputs from qnsc-infra. Dependency: the product's _shared stack must be applied
# before this one (infra-apply.yml orders them).
data "terraform_remote_state" "shared" {
  backend = "s3"
  config = {
    bucket = "qnsc-tofu-state"
    key    = var.shared_state_key
    region = "ap-southeast-1"
  }
}

# ── Shared runtime layer (VPC + NAT + ALB, and the WAF in prod) ───────────────
data "terraform_remote_state" "runtime" {
  backend = "s3"
  config = {
    bucket = "qnsc-tofu-state"
    key    = var.runtime_state_key
    region = "ap-southeast-1"
  }
}

locals {
  # Values that are DERIVED, not chosen. Anything an environment picks is a variable;
  # anything computed from those lives here, so the two callers cannot drift in how a
  # value is assembled — only in what they feed in.
  name     = "${var.product}-${var.env_slug}"
  app_url  = "https://${var.app_domain}"
  ecr_base = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${var.region}.amazonaws.com"

  kms_key_arn        = data.terraform_remote_state.shared.outputs.kms_key_arn
  cloudflare_zone_id = try(data.terraform_remote_state.shared.outputs.cloudflare_zone_id, "")

  # `rediss://`, never `redis://`: the cache module enables transit encryption
  # unconditionally, so a plaintext scheme would simply fail to connect. ioredis turns
  # TLS on from the scheme alone, so the app needs no configuration. Not a secret — an
  # endpoint address grants nothing on its own — so it travels as plain env.
  valkey_url = "rediss://${module.cache.endpoint}:${module.cache.port}"

  tags = { Environment = var.env }

  # Injected into api AND worker. One list, because a secret the api can read and the
  # worker cannot is a runtime failure discovered in production, and the two lists
  # drifted apart exactly that way while they were maintained per environment.
  app_secrets = [
    { name = "DATABASE_URL", secret_arn = module.secrets.secret_arns["db-url"] },
    { name = "JWT_PRIVATE_KEY", secret_arn = module.secrets.secret_arns["jwt-private-key"] },
    { name = "JWT_PUBLIC_KEY", secret_arn = module.secrets.secret_arns["jwt-public-key"] },
    { name = "COOKIE_SECRET", secret_arn = module.secrets.secret_arns["cookie-secret"] },
    { name = "GRAPH_CLIENT_SECRET", secret_arn = module.secrets.secret_arns["graph-client-secret"] },
  ]

  # Env both services need. Same reasoning as app_secrets: the queue URL, the bucket
  # and the cache endpoint are the contract between them, so they cannot be allowed to
  # disagree about any of the three.
  shared_env = [
    # "production" in DEVELOP too, on purpose: NODE_ENV selects the app's SECURITY
    # posture (cookie flags, dev-login refusal, error verbosity), and a deployed
    # environment should never run the relaxed one. Environment identity travels in
    # tags and log groups instead.
    { name = "NODE_ENV", value = "production" },
    { name = "VALKEY_URL", value = local.valkey_url },
    { name = "AWS_REGION", value = var.region },
    { name = "SQS_OUTBOX_URL", value = module.messaging.queue_urls["outbox"] },
    { name = "S3_FILES_BUCKET", value = module.app_bucket.bucket },
    { name = "ENTRA_TENANT_ID", value = var.entra_tenant_id },
    { name = "ENTRA_CLIENT_ID", value = var.entra_client_id },
    # Terraform already knows the deployed tag, so the version needs no CI plumbing.
    # Read by the OTel resource and by the served OpenAPI document, both of which
    # reported "dev" in every environment before this was injected.
    { name = "SERVICE_VERSION", value = var.image_tag },
  ]
}

# ── Secrets (scaffolding only — values are set out of band) ───────────────────
# Terraform creates the CONTAINERS and never their contents: a value in state is a
# value in the state file. Each is created empty, which is also the "unpopulated"
# signal — a task injected with an empty secret fails to boot, so a forgotten secret
# is a failed deploy rather than an app running on a blank credential.
module "secrets" {
  source      = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/secrets?ref=secrets-v1.1.0"
  prefix      = "${var.product}/${var.env}"
  kms_key_arn = local.kms_key_arn

  recovery_window_days = var.secrets_recovery_window_days

  secret_names = {
    "db-url"              = "PostgreSQL connection URL"
    "jwt-private-key"     = "JWT ES256 private key (PEM or base64-encoded PEM)"
    "jwt-public-key"      = "JWT ES256 public key (PEM or base64-encoded PEM)"
    "cookie-secret"       = "Fastify cookie signing secret (min 32 chars)"
    "graph-client-secret" = "Microsoft Graph app client secret (client-credentials flow for Graph sync jobs)"
  }

  tags = local.tags
}

# ── RDS PostgreSQL ────────────────────────────────────────────────────────────
module "rds" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/rds?ref=rds-v2.0.0"

  identifier        = local.name
  subnet_ids        = data.terraform_remote_state.runtime.outputs.data_subnet_ids
  security_group_id = data.terraform_remote_state.runtime.outputs.sg_rds_id
  kms_key_arn       = local.kms_key_arn

  instance_class           = var.rds.instance_class
  allocated_storage_gb     = var.rds.allocated_storage_gb
  max_allocated_storage_gb = var.rds.max_allocated_storage_gb
  multi_az                 = var.rds.multi_az
  deletion_protection      = var.rds.deletion_protection
  backup_retention_days    = var.rds.backup_retention_days
  monitoring_interval      = var.rds.monitoring_interval

  tags = local.tags
}

# ── Cache (Valkey) ────────────────────────────────────────────────────────────
# A shared node per environment, NOT a Valkey sidecar per Fargate task, and the
# difference is correctness rather than cost.
#
# Develop ran a sidecar at localhost:6379 in each of the api and worker tasks, which
# gives every task a PRIVATE cache. Three things in this app assume one:
#
#   - SSE notifications publish on `user:{id}` from whichever api task handled the
#     write, and the browser is subscribed through a different one, so the event was
#     delivered only when the two happened to be the same task;
#   - `relay:wake` is published by the api and subscribed by the WORKER, in a
#     different task entirely, so it never arrived and delivery silently fell back to
#     the 5s cron poll;
#   - the authorization cache is invalidated on role writes, and an invalidation that
#     reaches only the publishing task leaves every other task serving revoked
#     permissions until the 300s TTL expires.
#
# A cheaper node is the correct lever if this ever needs one; moving the cache back
# into the task is not. At-rest KMS and transit encryption are both on, which is why
# the URL above is `rediss://`.
module "cache" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/cache?ref=cache-v1.0.0"

  name              = "${local.name}-valkey"
  subnet_ids        = data.terraform_remote_state.runtime.outputs.data_subnet_ids
  security_group_id = data.terraform_remote_state.runtime.outputs.sg_cache_id
  kms_key_arn       = local.kms_key_arn

  mode      = var.cache.mode
  node_type = var.cache.node_type

  tags = local.tags
}

# ── Messaging (SQS + SNS) ─────────────────────────────────────────────────────
# The shared CMK in BOTH environments. Production passed the key and develop did not,
# so develop's topic fell back to the AWS-managed `alias/aws/sns` — the environment
# where an encryption regression would have to be caught was the one not exercising the
# setting. Queues are unaffected either way: the module enables SSE-SQS
# unconditionally, and this key only reaches the topic.
module "messaging" {
  source      = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/messaging?ref=messaging-v1.0.0"
  prefix      = local.name
  kms_key_arn = local.kms_key_arn

  queues = {
    outbox = { visibility_timeout = 60 }
  }

  topics = ["events"]

  tags = local.tags
}

# ── S3 upload bucket ──────────────────────────────────────────────────────────
module "app_bucket" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/app-bucket?ref=app-bucket-v1.0.1"

  name          = "${var.product}-${var.env}-uploads"
  kms_key_arn   = local.kms_key_arn
  versioning    = true
  force_destroy = var.uploads.force_destroy

  # Browsers PUT straight to a presigned URL, so the bucket — not the API — has to
  # allow the SPA's origin. The app's own origin is always allowed; anything else is
  # an explicit per-environment addition.
  cors_rules = [{
    allowed_headers = ["Content-Type", "Content-Length", "Content-MD5"]
    allowed_methods = ["PUT"]
    allowed_origins = concat([local.app_url], var.uploads.extra_cors_origins)
    expose_headers  = ["ETag"]
    max_age_seconds = 3600
  }]

  # Uploads are presigned before they are confirmed, so an abandoned upload leaves an
  # object nothing references. One day under `tmp/` is long enough for any real
  # confirmation to arrive.
  lifecycle_rules = [{
    id              = "expire-unconfirmed-uploads"
    prefix          = "tmp/"
    expiration_days = 1
  }]

  tags = local.tags
}

# ── ECS cluster ───────────────────────────────────────────────────────────────
module "ecs_cluster" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/ecs-cluster?ref=ecs-cluster-v1.0.0"
  name   = local.name
  tags   = local.tags

  # Always stated, never inherited: the module default is "enhanced", whose per-task
  # metrics are billed as custom CloudWatch metrics. See the variable.
  container_insights = var.container_insights
}

# ── ECS service — API ─────────────────────────────────────────────────────────
module "api" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/ecs-service?ref=ecs-service-v2.0.0"

  service_name = "api"
  cluster_name = module.ecs_cluster.cluster_name
  cluster_arn  = module.ecs_cluster.cluster_arn
  region       = var.region
  image_uri    = "${local.ecr_base}/${var.product}-api:${var.image_tag}"

  cpu            = var.api.cpu
  memory         = var.api.memory
  container_port = 3000

  vpc_id            = data.terraform_remote_state.runtime.outputs.vpc_id
  subnet_ids        = data.terraform_remote_state.runtime.outputs.private_subnet_ids
  security_group_id = data.terraform_remote_state.runtime.outputs.sg_app_id

  # One task at rest in both environments; autoscaling adds more on load. Production
  # buys redundancy through `max_count` and the ALB health check rather than by
  # standing a second task up permanently.
  desired_count      = 1
  min_count          = 1
  max_count          = var.api.max_count
  use_spot           = var.api.use_spot
  cpu_target_pct     = var.api.cpu_target_pct
  memory_target_pct  = var.api.memory_target_pct
  log_retention_days = var.log_retention_days

  # Host-based routing on the SHARED ALB, so opshub and rally coexist on one listener.
  # Priority 200 is opshub's slot in both environments (rally holds 100) — a constant,
  # not a variable, because two products colliding on a priority is a deploy failure
  # and the value has to be reasoned about across repos, not per environment.
  attach_alb        = true
  alb_listener_arn  = data.terraform_remote_state.runtime.outputs.https_listener_arn
  alb_priority      = 200
  alb_path_patterns = ["/*"]
  alb_host_headers  = [var.api_domain]
  health_check_path = "/v1/healthz"

  secret_arns = values(module.secrets.secret_arns)
  kms_key_arn = local.kms_key_arn
  secrets     = local.app_secrets

  environment_vars = concat(local.shared_env, [
    { name = "PORT", value = "3000" },
    { name = "CORS_ORIGINS", value = local.app_url },
    { name = "APP_URL", value = local.app_url },
  ])

  sqs_queue_arns = values(module.messaging.queue_arns)
  sns_topic_arns = values(module.messaging.topic_arns)
  s3_bucket_arns = [module.app_bucket.arn]

  tags = merge(local.tags, { Service = "api" })
}

# ── ECS service — worker ──────────────────────────────────────────────────────
module "worker" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/ecs-service?ref=ecs-service-v2.0.0"

  service_name = "worker"
  cluster_name = module.ecs_cluster.cluster_name
  cluster_arn  = module.ecs_cluster.cluster_arn
  region       = var.region
  image_uri    = "${local.ecr_base}/${var.product}-worker:${var.image_tag}"

  cpu    = var.worker.cpu
  memory = var.worker.memory

  vpc_id            = data.terraform_remote_state.runtime.outputs.vpc_id
  subnet_ids        = data.terraform_remote_state.runtime.outputs.private_subnet_ids
  security_group_id = data.terraform_remote_state.runtime.outputs.sg_app_id

  desired_count      = 1
  min_count          = 1
  max_count          = var.worker.max_count
  use_spot           = var.worker.use_spot
  log_retention_days = var.log_retention_days

  # No listener rule: the worker serves no HTTP traffic.
  attach_alb = false

  secret_arns = values(module.secrets.secret_arns)
  kms_key_arn = local.kms_key_arn
  secrets     = local.app_secrets

  environment_vars = local.shared_env

  sqs_queue_arns = values(module.messaging.queue_arns)
  sns_topic_arns = values(module.messaging.topic_arns)
  s3_bucket_arns = [module.app_bucket.arn]

  tags = merge(local.tags, { Service = "worker" })
}

# ── Migrator (one-shot task, run by the deploy pipeline) ──────────────────────
# Reuses the api's execution and task roles rather than minting its own: it reads the
# same database secret from the same KMS key, so a second pair of roles would be two
# copies of one grant to keep in step.
module "migrator" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/oneshot-task?ref=oneshot-task-v2.0.0"

  name               = "${local.name}-migrator"
  container_name     = "migrator"
  image              = "${local.ecr_base}/${var.product}-migrator:${var.image_tag}"
  cpu                = 512
  memory             = 1024
  execution_role_arn = module.api.execution_role_arn
  task_role_arn      = module.api.task_role_arn
  region             = var.region
  log_retention_days = var.log_retention_days

  environment = {
    NODE_ENV   = "production"
    AWS_REGION = var.region
  }

  secrets = {
    DATABASE_URL = module.secrets.secret_arns["db-url"]
  }

  tags = merge(local.tags, { Service = "migrator" })
}

# ── Web SPA — Cloudflare Pages ────────────────────────────────────────────────
# The SPA is served from Cloudflare Pages (zero egress, native SPA routing) and the
# API from its own Cloudflare-proxied subdomain, so the ALB is never directly
# reachable. Gated on cloudflare_account_id so the stack applies before the
# Cloudflare account is wired.
module "web" {
  count  = var.cloudflare_account_id != "" ? 1 : 0
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/pages-web?ref=pages-web-v1.0.1"

  account_id  = var.cloudflare_account_id
  name        = "${local.name}-web"
  zone_id     = local.cloudflare_zone_id
  domain      = local.cloudflare_zone_id != "" ? var.app_domain : ""
  record_name = local.cloudflare_zone_id != "" ? var.web_record : ""
  comment     = "${local.name} web SPA → Cloudflare Pages (managed by opshub infra ${var.env})"
}

# ── DNS — the API's public edge ───────────────────────────────────────────────
# Cloudflare-proxied (orange cloud): the ALB security group in runtime-<env> only
# admits Cloudflare edge ranges, so a grey-clouded record would simply time out.
module "dns_api" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/dns-record?ref=dns-record-v1.1.0"

  enabled = local.cloudflare_zone_id != ""
  zone_id = local.cloudflare_zone_id
  name    = var.api_record
  type    = "CNAME"
  content = data.terraform_remote_state.runtime.outputs.alb_dns_name
  proxied = true
  comment = "${local.name} API → ALB via Cloudflare proxy (managed by opshub infra ${var.env})"
}
