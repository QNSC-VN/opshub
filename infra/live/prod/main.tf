terraform {
  required_version = ">= 1.9"
  required_providers {
    aws        = { source = "hashicorp/aws", version = "~> 5.0" }
    cloudflare = { source = "cloudflare/cloudflare", version = "~> 4.0" }
  }

  backend "s3" {
    bucket         = "qnsc-tofu-state"
    key            = "opshub/prod/terraform.tfstate"
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
      Environment = "production"
      ManagedBy   = "opentofu"
    }
  }
}

data "aws_caller_identity" "current" {}

# Cloudflare provider — API token supplied out-of-band (TF_VAR_cloudflare_api_token
# / CLOUDFLARE_API_TOKEN in CI). DNS + Pages resources are created only when the
# zone id / account id are set. Same pattern as rally, keeping products consistent.
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
  env    = "production"
  name   = "opshub-prod"
  region = "ap-southeast-1"
  azs    = ["ap-southeast-1a", "ap-southeast-1b", "ap-southeast-1c"]

  kms_key_arn = data.terraform_remote_state.shared.outputs.kms_key_arn

  ecr_base       = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${local.region}.amazonaws.com"
  ecr_api_url    = "${local.ecr_base}/opshub-api:${var.image_tag}"
  ecr_worker_url = "${local.ecr_base}/opshub-worker:${var.image_tag}"

  # Cloudflare IPv4 ranges — single source of truth in qnsc-infra bootstrap
  # (read via _shared remote state), so a CF range change is one edit there.
  cloudflare_ipv4 = data.terraform_remote_state.shared.outputs.cloudflare_ipv4

  # Cloudflare zone id (qnsc.vn) from bootstrap via _shared. DNS + Pages custom
  # domain are created only when this is set, so the stack applies before wiring.
  cloudflare_zone_id = try(data.terraform_remote_state.shared.outputs.cloudflare_zone_id, "")

  # prod_tier switch (Option A): lean = shared runtime-prod cache + single-AZ
  # DB + 1 task/svc; ha = per-product cache + multi-AZ DB + 2 tasks/svc.
  is_ha = var.prod_tier == "ha"

  # Cache endpoint: lean uses the shared runtime-prod node (via remote state);
  # ha uses this product's own cache node (module.cache below). VALKEY_URL is an
  # env var (not a secret) — the endpoint isn't sensitive.
  cache_endpoint = coalesce(one(module.cache[*].endpoint), data.terraform_remote_state.runtime.outputs.cache_endpoint)
  cache_port     = coalesce(one(module.cache[*].port), data.terraform_remote_state.runtime.outputs.cache_port)
  valkey_url     = "redis://${local.cache_endpoint}:${local.cache_port}"
}

# ── Shared runtime layer (VPC + NAT + ALB + prod cache + WAF) ─────────────────
# Option A: the prod VPC/NAT/ALB/WAF (and, in lean tier, a shared cache node)
# live once per env in qnsc-infra/live/runtime-prod and are consumed here via
# remote state. RDS + Fargate stay per-product below.
data "terraform_remote_state" "runtime" {
  backend = "s3"
  config = {
    bucket = "qnsc-tofu-state"
    key    = "platform/runtime-prod/terraform.tfstate"
    region = "ap-southeast-1"
  }
}

# ── Secrets ───────────────────────────────────────────────────────────────────
module "secrets" {
  source               = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/secrets?ref=secrets-v1.0.0"
  prefix               = "opshub/${local.env}"
  kms_key_arn          = local.kms_key_arn
  recovery_window_days = 30 # longer recovery in production

  secret_names = {
    "db-url"              = "PostgreSQL connection URL"
    "jwt-private-key"     = "JWT ES256 private key (PEM or base64-encoded PEM)"
    "jwt-public-key"      = "JWT ES256 public key (PEM or base64-encoded PEM)"
    "cookie-secret"       = "Fastify cookie signing secret (min 32 chars)"
    "graph-client-secret" = "Microsoft Graph app client secret (client-credentials flow for Graph sync jobs)"
    # DEPRECATED: replaced by graph-client-secret. Retained (unwired from ECS) for a
    # zero-downtime rename so running tasks that still reference it can restart.
    # Remove once the GRAPH_CLIENT_SECRET task-def revision is live on all services.
    "entra-client-secret" = "DEPRECATED — superseded by graph-client-secret; safe to remove post-deploy"
  }

  tags = { Environment = local.env }
}

# ── RDS PostgreSQL (Multi-AZ, protected) ─────────────────────────────────────
module "rds" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/rds?ref=rds-v1.1.0"

  identifier        = local.name
  subnet_ids        = data.terraform_remote_state.runtime.outputs.data_subnet_ids
  security_group_id = data.terraform_remote_state.runtime.outputs.sg_rds_id
  kms_key_arn       = local.kms_key_arn

  instance_class           = local.is_ha ? "db.t4g.large" : "db.t4g.micro"
  allocated_storage_gb     = 100
  max_allocated_storage_gb = 500
  multi_az                 = local.is_ha # HA tier only — lean is single-AZ
  deletion_protection      = true
  backup_retention_days    = 30
  monitoring_interval      = local.is_ha ? 60 : 0 # Enhanced Monitoring in ha only

  tags = { Environment = local.env }
}

# ── ElastiCache Valkey (serverless — auto-scaling, prod reliability) ──────────
module "cache" {
  count  = local.is_ha ? 1 : 0
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/cache?ref=cache-v1.0.0"

  name              = "${local.name}-valkey"
  subnet_ids        = data.terraform_remote_state.runtime.outputs.data_subnet_ids
  security_group_id = data.terraform_remote_state.runtime.outputs.sg_cache_id
  kms_key_arn       = local.kms_key_arn

  mode      = "node"
  node_type = "cache.t4g.micro"

  tags = { Environment = local.env }
}

# ── Messaging (SQS + SNS) ─────────────────────────────────────────────────────
module "messaging" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/messaging?ref=messaging-v1.0.0"
  prefix = local.name

  queues = {
    outbox = { visibility_timeout = 60 }
  }

  topics = ["events"]

  kms_key_arn = local.kms_key_arn

  tags = { Environment = local.env }
}

# ── S3 upload bucket (shared app-bucket module) ───────────────────────────────
module "app_bucket" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/app-bucket?ref=app-bucket-v1.0.0"

  name        = "opshub-${local.env}-uploads"
  kms_key_arn = local.kms_key_arn
  versioning  = true
  # prod: force_destroy stays false (default) — never auto-delete uploads.

  cors_rules = [{
    allowed_headers = ["Content-Type", "Content-Length", "Content-MD5"]
    allowed_methods = ["PUT"]
    allowed_origins = ["https://opshub.qnsc.vn"]
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

# ── ALB: shared, lives in runtime-prod (with access logs + WAF). This stack
# attaches a host-header listener rule (module.api) to its HTTPS listener. ─────

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
  log_retention_days = 90

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
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/ecs-service?ref=ecs-service-v1.3.0"

  service_name = "api"
  cluster_name = module.ecs_cluster.cluster_name
  cluster_arn  = module.ecs_cluster.cluster_arn
  region       = local.region
  image_uri    = local.ecr_api_url

  cpu            = 1024
  memory         = 2048
  container_port = 3000

  vpc_id            = data.terraform_remote_state.runtime.outputs.vpc_id
  subnet_ids        = data.terraform_remote_state.runtime.outputs.private_subnet_ids
  security_group_id = data.terraform_remote_state.runtime.outputs.sg_app_id

  desired_count = local.is_ha ? 2 : 1 # ha: 2 for redundancy; lean: 1
  min_count     = local.is_ha ? 2 : 1
  max_count     = 6

  attach_alb        = true
  alb_listener_arn  = data.terraform_remote_state.runtime.outputs.https_listener_arn
  alb_priority      = 200 # unique on the shared prod ALB (rally=100)
  alb_path_patterns = ["/*"]
  alb_host_headers  = ["opshub-api.qnsc.vn"] # host-based routing on the shared prod ALB
  health_check_path = "/v1/healthz"

  secret_arns = values(module.secrets.secret_arns)
  kms_key_arn = local.kms_key_arn
  secrets = [
    { name = "DATABASE_URL", secret_arn = module.secrets.secret_arns["db-url"] },
    { name = "JWT_PRIVATE_KEY", secret_arn = module.secrets.secret_arns["jwt-private-key"] },
    { name = "JWT_PUBLIC_KEY", secret_arn = module.secrets.secret_arns["jwt-public-key"] },
    { name = "COOKIE_SECRET", secret_arn = module.secrets.secret_arns["cookie-secret"] },
    { name = "GRAPH_CLIENT_SECRET", secret_arn = module.secrets.secret_arns["graph-client-secret"] },
  ]
  environment_vars = [
    { name = "NODE_ENV", value = "production" },
    { name = "PORT", value = "3000" },
    { name = "VALKEY_URL", value = local.valkey_url }, # shared (lean) or per-product (ha) cache
    { name = "AWS_REGION", value = local.region },
    { name = "SQS_OUTBOX_URL", value = module.messaging.queue_urls["outbox"] },
    { name = "S3_UPLOAD_BUCKET", value = module.app_bucket.bucket },
    { name = "ENTRA_TENANT_ID", value = var.entra_tenant_id },
    { name = "ENTRA_CLIENT_ID", value = var.entra_client_id },
    { name = "CORS_ORIGINS", value = "https://opshub.qnsc.vn" },
    { name = "APP_URL", value = "https://opshub.qnsc.vn" },
  ]

  sqs_queue_arns     = values(module.messaging.queue_arns)
  sns_topic_arns     = values(module.messaging.topic_arns)
  s3_bucket_arns     = [module.app_bucket.arn]
  cpu_target_pct     = 60 # tighter target in prod — scales out earlier
  memory_target_pct  = 70
  log_retention_days = 90 # SOC 2 minimum for prod logs

  tags = { Environment = local.env, Service = "api" }
}

# ── Worker service ────────────────────────────────────────────────────────────
module "worker" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/ecs-service?ref=ecs-service-v1.3.0"

  service_name = "worker"
  cluster_name = module.ecs_cluster.cluster_name
  cluster_arn  = module.ecs_cluster.cluster_arn
  region       = local.region
  image_uri    = local.ecr_worker_url

  cpu    = 512
  memory = 1024

  vpc_id            = data.terraform_remote_state.runtime.outputs.vpc_id
  subnet_ids        = data.terraform_remote_state.runtime.outputs.private_subnet_ids
  security_group_id = data.terraform_remote_state.runtime.outputs.sg_app_id

  desired_count = local.is_ha ? 2 : 1
  min_count     = local.is_ha ? 2 : 1
  max_count     = 4

  attach_alb = false

  secret_arns = values(module.secrets.secret_arns)
  kms_key_arn = local.kms_key_arn
  secrets = [
    { name = "DATABASE_URL", secret_arn = module.secrets.secret_arns["db-url"] },
    { name = "JWT_PRIVATE_KEY", secret_arn = module.secrets.secret_arns["jwt-private-key"] },
    { name = "JWT_PUBLIC_KEY", secret_arn = module.secrets.secret_arns["jwt-public-key"] },
    { name = "COOKIE_SECRET", secret_arn = module.secrets.secret_arns["cookie-secret"] },
    { name = "GRAPH_CLIENT_SECRET", secret_arn = module.secrets.secret_arns["graph-client-secret"] },
  ]
  environment_vars = [
    { name = "NODE_ENV", value = "production" },
    { name = "VALKEY_URL", value = local.valkey_url },
    { name = "AWS_REGION", value = local.region },
    { name = "SQS_OUTBOX_URL", value = module.messaging.queue_urls["outbox"] },
    { name = "S3_UPLOAD_BUCKET", value = module.app_bucket.bucket },
    { name = "ENTRA_TENANT_ID", value = var.entra_tenant_id },
    { name = "ENTRA_CLIENT_ID", value = var.entra_client_id },
  ]

  sqs_queue_arns     = values(module.messaging.queue_arns)
  sns_topic_arns     = values(module.messaging.topic_arns)
  s3_bucket_arns     = [module.app_bucket.arn]
  log_retention_days = 90

  tags = { Environment = local.env, Service = "worker" }
}

# ── WAF: lives in runtime-prod and is associated with the shared ALB there. ──

# ── Web SPA — Cloudflare Pages (zero-egress, native SPA routing) ─────────────
# Consistent with rally + opshub develop: SPA on Cloudflare Pages
# (opshub.qnsc.vn), API on its own Cloudflare-proxied subdomain → ALB.
# Replaces the deprecated CloudFront same-origin proxy. Gated on
# cloudflare_account_id so the stack applies before the account is wired.
module "web" {
  count  = var.cloudflare_account_id != "" ? 1 : 0
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/pages-web?ref=pages-web-v1.0.0"

  account_id  = var.cloudflare_account_id
  name        = "opshub-prod-web"
  zone_id     = local.cloudflare_zone_id
  domain      = local.cloudflare_zone_id != "" ? var.web_domain : ""
  record_name = local.cloudflare_zone_id != "" ? "opshub" : ""
  comment     = "opshub-prod web SPA → Cloudflare Pages (managed by opshub-infra prod)"
}

# ── DNS — opshub-api.qnsc.vn → ALB (Cloudflare-proxied edge) ─────────────────
module "dns_api" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/dns-record?ref=dns-record-v1.1.0"

  enabled = local.cloudflare_zone_id != ""
  zone_id = local.cloudflare_zone_id
  name    = "opshub-api"
  type    = "CNAME"
  content = data.terraform_remote_state.runtime.outputs.alb_dns_name
  proxied = true
  comment = "opshub-prod API → ALB via Cloudflare proxy (managed by opshub-infra prod)"
}
