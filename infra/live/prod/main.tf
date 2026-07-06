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
}

# ── Networking ────────────────────────────────────────────────────────────────
module "network" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/network?ref=network-v1.1.2"

  name   = local.name
  region = local.region
  azs    = local.azs

  vpc_cidr             = "10.30.0.0/16"
  public_subnet_cidrs  = ["10.30.0.0/24", "10.30.1.0/24", "10.30.2.0/24"]
  private_subnet_cidrs = ["10.30.10.0/24", "10.30.11.0/24", "10.30.12.0/24"]
  data_subnet_cidrs    = ["10.30.20.0/24", "10.30.21.0/24", "10.30.22.0/24"]

  multi_az_nat               = false # single NAT — saves $87/mo; outbound HA sacrificed, inbound HA (ALB) unaffected
  enable_interface_endpoints = true  # prod: VPC endpoints reduce NAT data cost for ECR/SM traffic
  app_port                   = 3000
  alb_ingress_cidrs          = local.cloudflare_ipv4 # lock ALB to Cloudflare orange-cloud proxy IPs
  enable_flow_logs           = true
  flow_log_retention_days    = 90 # SOC 2 CC7.2 minimum

  tags = { Environment = local.env }
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
    "entra-client-secret" = "Azure Entra app client secret (JWKS + Graph API)"
    "valkey-url"          = "ElastiCache Valkey connection URL"
  }

  tags = { Environment = local.env }
}

# ── RDS PostgreSQL (Multi-AZ, protected) ─────────────────────────────────────
module "rds" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/rds?ref=rds-v1.0.1"

  identifier        = local.name
  subnet_ids        = module.network.data_subnet_ids
  security_group_id = module.network.sg_rds_id
  kms_key_arn       = local.kms_key_arn

  instance_class           = "db.t4g.large"
  allocated_storage_gb     = 100
  max_allocated_storage_gb = 500
  multi_az                 = true
  deletion_protection      = true
  backup_retention_days    = 30
  monitoring_interval      = 60 # Enhanced Monitoring every minute in production

  tags = { Environment = local.env }
}

# ── ElastiCache Valkey (serverless — auto-scaling, prod reliability) ──────────
module "cache" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/cache?ref=cache-v1.0.0"

  name              = "${local.name}-valkey"
  subnet_ids        = module.network.data_subnet_ids
  security_group_id = module.network.sg_cache_id
  kms_key_arn       = local.kms_key_arn

  mode                    = "serverless"
  max_data_storage_gb     = 5
  max_ecpu_per_second     = 5000
  snapshot_retention_days = 7

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
    allowed_origins = ["https://app.opshub.qnsc.vn"]
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
module "alb_logs" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/alb-logs?ref=alb-logs-v1.0.0"

  bucket_name    = "${local.name}-alb-logs"
  retention_days = 90 # SOC 2 minimum for prod logs
  tags           = { Environment = local.env }
}

# ── ALB (shared module: LB + HTTPS/HTTP listener pair) ───────────────────────
# Prod: deletion protection + access logs. opshub proxies /v1/* via the HTTP
# listener for its CloudFront http-only origin (see rule below), unlike rally
# prod which attaches directly to HTTPS.
module "alb" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/alb?ref=alb-v1.0.0"

  name               = local.name
  security_group_ids = [module.network.sg_alb_id]
  subnet_ids         = module.network.public_subnet_ids
  certificate_arn    = var.acm_cert_arn

  enable_deletion_protection = true
  access_logs_bucket         = module.alb_logs.bucket_id

  tags = { Environment = local.env }
}

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
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/ecs-service?ref=ecs-service-v1.1.0"

  service_name = "api"
  cluster_name = module.ecs_cluster.cluster_name
  cluster_arn  = module.ecs_cluster.cluster_arn
  region       = local.region
  image_uri    = local.ecr_api_url

  cpu            = 1024
  memory         = 2048
  container_port = 3000

  vpc_id            = module.network.vpc_id
  subnet_ids        = module.network.private_subnet_ids
  security_group_id = module.network.sg_app_id

  desired_count = 2 # at least 2 for HA
  min_count     = 2
  max_count     = 6

  attach_alb        = true
  alb_listener_arn  = module.alb.https_listener_arn
  alb_priority      = 100
  alb_path_patterns = ["/*"]
  health_check_path = "/v1/healthz"

  secret_arns = values(module.secrets.secret_arns)
  kms_key_arn = local.kms_key_arn
  secrets = [
    { name = "DATABASE_URL", secret_arn = module.secrets.secret_arns["db-url"] },
    { name = "JWT_PRIVATE_KEY", secret_arn = module.secrets.secret_arns["jwt-private-key"] },
    { name = "JWT_PUBLIC_KEY", secret_arn = module.secrets.secret_arns["jwt-public-key"] },
    { name = "COOKIE_SECRET", secret_arn = module.secrets.secret_arns["cookie-secret"] },
    { name = "ENTRA_CLIENT_SECRET", secret_arn = module.secrets.secret_arns["entra-client-secret"] },
    { name = "VALKEY_URL", secret_arn = module.secrets.secret_arns["valkey-url"] },
  ]
  environment_vars = [
    { name = "NODE_ENV", value = "production" },
    { name = "PORT", value = "3000" },
    { name = "AWS_REGION", value = local.region },
    { name = "SQS_OUTBOX_URL", value = module.messaging.queue_urls["outbox"] },
    { name = "S3_UPLOAD_BUCKET", value = module.app_bucket.bucket },
    { name = "ENTRA_TENANT_ID", value = var.entra_tenant_id },
    { name = "ENTRA_CLIENT_ID", value = var.entra_client_id },
    { name = "CORS_ORIGINS", value = "https://app.opshub.qnsc.vn" },
    { name = "APP_URL", value = "https://app.opshub.qnsc.vn" },
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
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/ecs-service?ref=ecs-service-v1.1.0"

  service_name = "worker"
  cluster_name = module.ecs_cluster.cluster_name
  cluster_arn  = module.ecs_cluster.cluster_arn
  region       = local.region
  image_uri    = local.ecr_worker_url

  cpu    = 512
  memory = 1024

  vpc_id            = module.network.vpc_id
  subnet_ids        = module.network.private_subnet_ids
  security_group_id = module.network.sg_app_id

  desired_count = 2
  min_count     = 1
  max_count     = 4

  attach_alb = false

  secret_arns = values(module.secrets.secret_arns)
  kms_key_arn = local.kms_key_arn
  secrets = [
    { name = "DATABASE_URL", secret_arn = module.secrets.secret_arns["db-url"] },
    { name = "JWT_PRIVATE_KEY", secret_arn = module.secrets.secret_arns["jwt-private-key"] },
    { name = "JWT_PUBLIC_KEY", secret_arn = module.secrets.secret_arns["jwt-public-key"] },
    { name = "COOKIE_SECRET", secret_arn = module.secrets.secret_arns["cookie-secret"] },
    { name = "ENTRA_CLIENT_SECRET", secret_arn = module.secrets.secret_arns["entra-client-secret"] },
    { name = "VALKEY_URL", secret_arn = module.secrets.secret_arns["valkey-url"] },
  ]
  environment_vars = [
    { name = "NODE_ENV", value = "production" },
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

# ── WAF ───────────────────────────────────────────────────────────────────────
module "waf" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/waf?ref=waf-v1.0.1"

  name                = local.name
  alb_arn             = module.alb.arn
  rate_limit_per_5min = 5000

  tags = { Environment = local.env }
}

# ── Web SPA — Cloudflare Pages (zero-egress, native SPA routing) ─────────────
# Consistent with rally + opshub develop: SPA on Cloudflare Pages
# (app.opshub.qnsc.vn), API on its own Cloudflare-proxied subdomain → ALB.
# Replaces the deprecated CloudFront same-origin proxy. Gated on
# cloudflare_account_id so the stack applies before the account is wired.
module "web" {
  count  = var.cloudflare_account_id != "" ? 1 : 0
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/pages-web?ref=pages-web-v1.0.0"

  account_id  = var.cloudflare_account_id
  name        = "opshub-prod-web"
  zone_id     = local.cloudflare_zone_id
  domain      = local.cloudflare_zone_id != "" ? "app.opshub.qnsc.vn" : ""
  record_name = local.cloudflare_zone_id != "" ? "app" : ""
  comment     = "opshub-prod web SPA → Cloudflare Pages (managed by opshub-infra prod)"
}

# ── DNS — app-api.opshub.qnsc.vn → ALB (Cloudflare-proxied edge) ─────────────
module "dns_api" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/dns-record?ref=dns-record-v1.0.0"

  enabled = local.cloudflare_zone_id != ""
  zone_id = local.cloudflare_zone_id
  name    = "app-api"
  type    = "CNAME"
  content = module.alb.dns_name
  proxied = true
  comment = "opshub-prod API → ALB via Cloudflare proxy (managed by opshub-infra prod)"
}
