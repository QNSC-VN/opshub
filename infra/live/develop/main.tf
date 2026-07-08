terraform {
  required_version = ">= 1.9"
  required_providers {
    aws        = { source = "hashicorp/aws", version = "~> 5.0" }
    cloudflare = { source = "cloudflare/cloudflare", version = "~> 4.0" }
  }

  backend "s3" {
    bucket         = "qnsc-tofu-state"
    key            = "opshub/develop/terraform.tfstate"
    region         = "ap-southeast-1"
    encrypt        = true
    dynamodb_table = "qnsc-tofu-locks"
  }
}

provider "aws" {
  region = "ap-southeast-1"
  default_tags {
    tags = {
      Project     = "opshub"
      Environment = "develop"
      ManagedBy   = "opentofu"
    }
  }
}

data "aws_caller_identity" "current" {}

# Cloudflare provider — API token supplied out-of-band (TF_VAR_cloudflare_api_token
# / CLOUDFLARE_API_TOKEN in CI). DNS + Pages resources are created only when the
# zone id / account id are set, so the stack applies cleanly before Cloudflare is
# wired. Same pattern as rally, keeping the two products consistent.
provider "cloudflare" {
  api_token = var.cloudflare_api_token != "" ? var.cloudflare_api_token : null
}

# ── Read shared layer outputs (ECR URLs, KMS ARN, artifacts bucket) ───────────
data "terraform_remote_state" "shared" {
  backend = "s3"
  config = {
    bucket = "qnsc-tofu-state"
    key    = "opshub/shared/terraform.tfstate"
    region = "ap-southeast-1"
  }
}

locals {
  env    = "develop"
  name   = "opshub-develop"
  region = "ap-southeast-1"
  azs    = ["ap-southeast-1a", "ap-southeast-1b", "ap-southeast-1c"]

  kms_key_arn = data.terraform_remote_state.shared.outputs.kms_key_arn

  ecr_base       = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${local.region}.amazonaws.com"
  ecr_api_url    = "${local.ecr_base}/opshub-api:${var.image_tag}"
  ecr_worker_url = "${local.ecr_base}/opshub-worker:${var.image_tag}"

  # Cloudflare IPv4 ranges — single source of truth in qnsc-infra bootstrap
  # (read via _shared remote state), so a CF range change is one edit there.
  # Matches opshub prod: the ALB is fronted by Cloudflare, so ingress is locked
  # to Cloudflare edge IPs (keeps dev/prod parity within opshub).
  cloudflare_ipv4 = data.terraform_remote_state.shared.outputs.cloudflare_ipv4

  # Cloudflare zone id (qnsc.vn) from bootstrap via _shared. DNS + Pages custom
  # domain are created only when this is set, so the stack applies before wiring.
  cloudflare_zone_id = try(data.terraform_remote_state.shared.outputs.cloudflare_zone_id, "")

  # Dev cache: a Valkey sidecar per task (localhost:6379) instead of a shared
  # ElastiCache node — $0 in dev. Each task gets its own in-task instance
  # (accepted dev tradeoff); prod uses the shared runtime-prod cache node.
  valkey_sidecar = {
    name         = "valkey"
    image        = "valkey/valkey:8-alpine"
    essential    = false
    portMappings = [{ containerPort = 6379, protocol = "tcp" }]
    environment  = []
  }
}

# ── Shared runtime layer (VPC + NAT + ALB) ────────────────────────────────────
# Option A: the VPC/NAT/ALB now live once per env in qnsc-infra/live/runtime-dev
# and are shared by every product. This stack consumes them via remote state
# instead of creating its own. RDS + Fargate stay per-product below.
data "terraform_remote_state" "runtime" {
  backend = "s3"
  config = {
    bucket = "qnsc-tofu-state"
    key    = "platform/runtime-dev/terraform.tfstate"
    region = "ap-southeast-1"
  }
}

# ── Secrets (scaffolding only — fill values in Secrets Manager console) ───────
module "secrets" {
  source      = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/secrets?ref=secrets-v1.0.0"
  prefix      = "opshub/${local.env}"
  kms_key_arn = local.kms_key_arn

  # Dev: delete secrets immediately on teardown (no recovery window) so a
  # destroy+redeploy cycle doesn't hit "secret scheduled for deletion". Matches
  # rally develop. Prod keeps the default recovery window.
  recovery_window_days = 0

  secret_names = {
    "db-url"              = "PostgreSQL connection URL"
    "jwt-private-key"     = "JWT ES256 private key (PEM or base64-encoded PEM)"
    "jwt-public-key"      = "JWT ES256 public key (PEM or base64-encoded PEM)"
    "cookie-secret"       = "Fastify cookie signing secret (min 32 chars)"
    "entra-client-secret" = "Azure Entra app client secret (JWKS + Graph API)"
  }

  tags = { Environment = local.env }
}

# ── RDS PostgreSQL ─────────────────────────────────────────────────────────────
module "rds" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/rds?ref=rds-v1.0.1"

  identifier        = local.name
  subnet_ids        = data.terraform_remote_state.runtime.outputs.data_subnet_ids
  security_group_id = data.terraform_remote_state.runtime.outputs.sg_rds_id
  kms_key_arn       = local.kms_key_arn

  instance_class           = "db.t4g.micro"
  allocated_storage_gb     = 20
  max_allocated_storage_gb = 100
  multi_az                 = false
  deletion_protection      = false
  backup_retention_days    = 3
  monitoring_interval      = 0 # disable Enhanced Monitoring in develop (saves CloudWatch cost)

  tags = { Environment = local.env, AutoStop = "true" }
}

# ── Cache ─────────────────────────────────────────────────────────────────────
# Dev has no ElastiCache node — each Fargate task runs a Valkey sidecar at
# localhost:6379 (see local.valkey_sidecar, wired into module.api/worker).

# ── Messaging (SQS + SNS) ─────────────────────────────────────────────────────
module "messaging" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/messaging?ref=messaging-v1.0.0"
  prefix = local.name

  queues = {
    outbox = { visibility_timeout = 60 }
  }

  topics = ["events"]

  tags = { Environment = local.env }
}

# ── S3 upload bucket ──────────────────────────────────────────────────────────
module "app_bucket" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/app-bucket?ref=app-bucket-v1.0.0"

  name          = "opshub-${local.env}-uploads"
  kms_key_arn   = local.kms_key_arn
  versioning    = true
  force_destroy = true

  cors_rules = [{
    allowed_headers = ["Content-Type", "Content-Length", "Content-MD5"]
    allowed_methods = ["PUT"]
    allowed_origins = ["http://localhost:5174", "https://opshub-dev.qnsc.vn"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3600
  }]

  lifecycle_rules = [{
    id              = "expire-unconfirmed-uploads"
    prefix          = "tmp/"
    expiration_days = 1
  }]

  tags = { Environment = local.env }
}

# ── ALB ───────────────────────────────────────────────────────────────────────
# The ALB is shared and lives in runtime-dev. module.api attaches a host-header
# listener rule (opshub-api-dev.qnsc.vn, priority 200) to its HTTPS listener.

# ── ECS Cluster ───────────────────────────────────────────────────────────────
module "ecs_cluster" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/ecs-cluster?ref=ecs-cluster-v1.0.0"
  name   = local.name
  tags   = { Environment = local.env }
}

# ── Migrator (one-shot, triggered by CI) ──────────────────────────────────────
module "migrator" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/oneshot-task?ref=oneshot-task-v1.0.0"

  name               = "${local.name}-migrator"
  container_name     = "migrator"
  image              = "${local.ecr_base}/opshub-migrator:${var.image_tag}"
  cpu                = 512
  memory             = 1024
  execution_role_arn = module.api.execution_role_arn
  task_role_arn      = module.api.task_role_arn
  region             = local.region
  log_retention_days = 7 # dev: keep only 7 days (migrator is a one-shot task)

  environment = {
    NODE_ENV   = "production"
    AWS_REGION = local.region
  }

  secrets = {
    DATABASE_URL = module.secrets.secret_arns["db-url"]
  }

  tags = { Environment = local.env, Service = "migrator" }
}

# ── API service ───────────────────────────────────────────────────────────────
module "api" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/ecs-service?ref=ecs-service-v1.2.0"

  service_name = "api"
  cluster_name = module.ecs_cluster.cluster_name
  cluster_arn  = module.ecs_cluster.cluster_arn
  region       = local.region
  image_uri    = local.ecr_api_url

  cpu            = 512
  memory         = 1024
  container_port = 3000

  vpc_id            = data.terraform_remote_state.runtime.outputs.vpc_id
  subnet_ids        = data.terraform_remote_state.runtime.outputs.private_subnet_ids
  security_group_id = data.terraform_remote_state.runtime.outputs.sg_app_id

  desired_count      = 1
  min_count          = 1
  max_count          = 3
  use_spot           = true # Fargate Spot: saves ~70% on compute
  log_retention_days = 7    # dev: 7 days sufficient for debugging

  attach_alb        = true
  alb_listener_arn  = data.terraform_remote_state.runtime.outputs.https_listener_arn
  alb_priority      = 200
  alb_path_patterns = ["/*"]
  alb_host_headers  = ["opshub-api-dev.qnsc.vn"] # host-based routing on the shared ALB
  health_check_path = "/v1/healthz"

  # Dev Valkey sidecar (localhost:6379) — replaces the ElastiCache node.
  additional_containers = [local.valkey_sidecar]

  secret_arns = values(module.secrets.secret_arns)
  kms_key_arn = local.kms_key_arn
  secrets = [
    { name = "DATABASE_URL", secret_arn = module.secrets.secret_arns["db-url"] },
    { name = "JWT_PRIVATE_KEY", secret_arn = module.secrets.secret_arns["jwt-private-key"] },
    { name = "JWT_PUBLIC_KEY", secret_arn = module.secrets.secret_arns["jwt-public-key"] },
    { name = "COOKIE_SECRET", secret_arn = module.secrets.secret_arns["cookie-secret"] },
    { name = "ENTRA_CLIENT_SECRET", secret_arn = module.secrets.secret_arns["entra-client-secret"] },
  ]
  environment_vars = [
    { name = "NODE_ENV", value = "production" },
    { name = "PORT", value = "3000" },
    { name = "VALKEY_URL", value = "redis://localhost:6379" }, # dev: Valkey sidecar
    { name = "AWS_REGION", value = local.region },
    { name = "SQS_OUTBOX_URL", value = module.messaging.queue_urls["outbox"] },
    { name = "S3_UPLOAD_BUCKET", value = module.app_bucket.bucket },
    { name = "ENTRA_TENANT_ID", value = var.entra_tenant_id },
    { name = "ENTRA_CLIENT_ID", value = var.entra_client_id },
    { name = "CORS_ORIGINS", value = "https://opshub-dev.qnsc.vn" },
    { name = "APP_URL", value = "https://opshub-dev.qnsc.vn" },
  ]

  sqs_queue_arns = values(module.messaging.queue_arns)
  sns_topic_arns = values(module.messaging.topic_arns)
  s3_bucket_arns = [module.app_bucket.arn]

  tags = { Environment = local.env, Service = "api", AutoStop = "true" }
}

# ── Worker service ────────────────────────────────────────────────────────────
module "worker" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/ecs-service?ref=ecs-service-v1.2.0"

  service_name = "worker"
  cluster_name = module.ecs_cluster.cluster_name
  cluster_arn  = module.ecs_cluster.cluster_arn
  region       = local.region
  image_uri    = local.ecr_worker_url

  cpu    = 256
  memory = 512

  vpc_id            = data.terraform_remote_state.runtime.outputs.vpc_id
  subnet_ids        = data.terraform_remote_state.runtime.outputs.private_subnet_ids
  security_group_id = data.terraform_remote_state.runtime.outputs.sg_app_id

  desired_count      = 1
  min_count          = 1
  max_count          = 2
  use_spot           = true # Fargate Spot: saves ~70% on compute
  log_retention_days = 7    # dev: 7 days sufficient for debugging

  attach_alb = false

  # Dev Valkey sidecar (localhost:6379) — worker has its own in-task cache.
  additional_containers = [local.valkey_sidecar]

  secret_arns = values(module.secrets.secret_arns)
  kms_key_arn = local.kms_key_arn
  secrets = [
    { name = "DATABASE_URL", secret_arn = module.secrets.secret_arns["db-url"] },
    { name = "JWT_PRIVATE_KEY", secret_arn = module.secrets.secret_arns["jwt-private-key"] },
    { name = "JWT_PUBLIC_KEY", secret_arn = module.secrets.secret_arns["jwt-public-key"] },
    { name = "COOKIE_SECRET", secret_arn = module.secrets.secret_arns["cookie-secret"] },
    { name = "ENTRA_CLIENT_SECRET", secret_arn = module.secrets.secret_arns["entra-client-secret"] },
  ]
  environment_vars = [
    { name = "NODE_ENV", value = "production" },
    { name = "VALKEY_URL", value = "redis://localhost:6379" }, # dev: Valkey sidecar
    { name = "AWS_REGION", value = local.region },
    { name = "SQS_OUTBOX_URL", value = module.messaging.queue_urls["outbox"] },
    { name = "S3_UPLOAD_BUCKET", value = module.app_bucket.bucket },
    { name = "ENTRA_TENANT_ID", value = var.entra_tenant_id },
    { name = "ENTRA_CLIENT_ID", value = var.entra_client_id },
  ]

  sqs_queue_arns = values(module.messaging.queue_arns)
  sns_topic_arns = values(module.messaging.topic_arns)
  s3_bucket_arns = [module.app_bucket.arn]

  tags = { Environment = local.env, Service = "worker", AutoStop = "true" }
}

# ── WAF: not used in dev. In prod the WebACL lives in runtime-prod and is
# associated with the shared ALB there. ───────────────────────────────────────

# ── Web SPA — Cloudflare Pages (zero-egress, native SPA routing) ─────────────
# Consistent with rally: SPA on Cloudflare Pages (opshub-dev.qnsc.vn), API
# on its own Cloudflare-proxied subdomain → ALB. Replaces the deprecated
# CloudFront same-origin proxy. Gated on cloudflare_account_id so the stack
# still applies before the Cloudflare account is wired.
module "web" {
  count  = var.cloudflare_account_id != "" ? 1 : 0
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/pages-web?ref=pages-web-v1.0.0"

  account_id  = var.cloudflare_account_id
  name        = "opshub-develop-web"
  zone_id     = local.cloudflare_zone_id
  domain      = local.cloudflare_zone_id != "" ? "opshub-dev.qnsc.vn" : ""
  record_name = local.cloudflare_zone_id != "" ? "opshub-dev" : ""
  comment     = "opshub-develop web SPA → Cloudflare Pages (managed by opshub-infra develop)"
}

# ── DNS — opshub-api-dev.qnsc.vn → ALB (Cloudflare-proxied edge) ─────────────
# The API's public edge, matching rally. Cloudflare-proxied (orange cloud) so
# the ALB is never directly reachable; the ALB SG is locked to cloudflare_ipv4.
# The api ECS service already forwards /* on the ALB HTTPS listener.
module "dns_api" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/dns-record?ref=dns-record-v1.0.0"

  enabled = local.cloudflare_zone_id != ""
  zone_id = local.cloudflare_zone_id
  name    = "opshub-api-dev"
  type    = "CNAME"
  content = data.terraform_remote_state.runtime.outputs.alb_dns_name
  proxied = true
  comment = "opshub-develop API → ALB via Cloudflare proxy (managed by opshub-infra develop)"
}

# ── Dev scheduler: stop RDS + scale ECS to 0 off-hours ───────────────────────
# Tag-driven: acts on resources tagged AutoStop=true.
# Stops at 8pm ICT, restarts at 8am ICT weekdays.
module "dev_scheduler" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/dev-scheduler?ref=dev-scheduler-v1.1.0"
  name   = local.name
  tags   = { Environment = local.env }
}
