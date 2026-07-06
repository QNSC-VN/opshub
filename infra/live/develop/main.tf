terraform {
  required_version = ">= 1.9"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
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
}

# ── Networking ────────────────────────────────────────────────────────────────
module "network" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/network?ref=network-v1.1.2"

  name   = local.name
  region = local.region
  azs    = local.azs

  # 10.50.x.x — avoids overlap with rally-prod (10.20) and opshub-prod (10.30)
  vpc_cidr             = "10.50.0.0/16"
  public_subnet_cidrs  = ["10.50.0.0/24", "10.50.1.0/24", "10.50.2.0/24"]
  private_subnet_cidrs = ["10.50.10.0/24", "10.50.11.0/24", "10.50.12.0/24"]
  data_subnet_cidrs    = ["10.50.20.0/24", "10.50.21.0/24", "10.50.22.0/24"]

  nat_type                   = "instance" # dev: fck-nat t4g.nano ~$3/mo vs NAT GW ~$33/mo
  enable_interface_endpoints = false # dev: NAT already covers egress — save ~$22/mo
  app_port                   = 3000
  enable_flow_logs           = false # dev: no compliance requirement — save ~$4/mo
  flow_log_retention_days    = 30

  tags = { Environment = local.env }
}

# ── Secrets (scaffolding only — fill values in Secrets Manager console) ───────
module "secrets" {
  source      = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/secrets?ref=secrets-v1.0.0"
  prefix      = "opshub/${local.env}"
  kms_key_arn = local.kms_key_arn

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

# ── RDS PostgreSQL ─────────────────────────────────────────────────────────────
module "rds" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/rds?ref=rds-v1.0.1"

  identifier        = local.name
  subnet_ids        = module.network.data_subnet_ids
  security_group_id = module.network.sg_rds_id
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

# ── ElastiCache Valkey (node mode — cheaper than serverless in dev) ───────────
module "cache" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/cache?ref=cache-v1.0.0"

  name              = "${local.name}-valkey"
  subnet_ids        = module.network.data_subnet_ids
  security_group_id = module.network.sg_cache_id
  kms_key_arn       = local.kms_key_arn

  mode = "node" # dev: single cache.t4g.micro node (~$11/mo) vs serverless ~$90 floor

  tags = { Environment = local.env, AutoStop = "true" }
}

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
resource "aws_s3_bucket" "uploads" {
  bucket        = "opshub-${local.env}-uploads"
  force_destroy = true
  tags          = { Name = "opshub-${local.env}-uploads", Environment = local.env }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = local.kms_key_arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "uploads" {
  bucket                  = aws_s3_bucket.uploads.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_lifecycle_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  rule {
    id     = "expire-unconfirmed-uploads"
    status = "Enabled"
    filter { prefix = "tmp/" }
    expiration { days = 1 }
  }
}

resource "aws_s3_bucket_cors_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  cors_rule {
    allowed_headers = ["Content-Type", "Content-Length", "Content-MD5"]
    allowed_methods = ["PUT"]
    allowed_origins = ["http://localhost:5174", "https://app-dev.opshub.qnsc.vn"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3600
  }
}

# ── ALB (shared module: LB + HTTPS/HTTP listener pair) ───────────────────────
module "alb" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/alb?ref=alb-v1.0.0"

  name               = local.name
  security_group_ids = [module.network.sg_alb_id]
  subnet_ids         = module.network.public_subnet_ids
  certificate_arn    = var.acm_cert_arn

  enable_deletion_protection = false # dev: easy teardown

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

  name           = "${local.name}-migrator"
  container_name = "migrator"
  image          = "${local.ecr_base}/opshub-migrator:${var.image_tag}"
  cpu            = 512
  memory         = 1024
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
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/ecs-service?ref=ecs-service-v1.1.0"

  service_name = "api"
  cluster_name = module.ecs_cluster.cluster_name
  cluster_arn  = module.ecs_cluster.cluster_arn
  region       = local.region
  image_uri    = local.ecr_api_url

  cpu            = 512
  memory         = 1024
  container_port = 3000

  vpc_id            = module.network.vpc_id
  subnet_ids        = module.network.private_subnet_ids
  security_group_id = module.network.sg_app_id

  desired_count      = 1
  min_count          = 1
  max_count          = 3
  use_spot           = true # Fargate Spot: saves ~70% on compute
  log_retention_days = 7    # dev: 7 days sufficient for debugging

  attach_alb        = true
  alb_listener_arn  = module.alb.https_listener_arn
  alb_priority      = 100
  alb_path_patterns = ["/*"]
  health_check_path = "/v1/healthz"

  secret_arns = values(module.secrets.secret_arns)
  kms_key_arn = local.kms_key_arn
  secrets = [
    { name = "DATABASE_URL",        secret_arn = module.secrets.secret_arns["db-url"] },
    { name = "JWT_PRIVATE_KEY",     secret_arn = module.secrets.secret_arns["jwt-private-key"] },
    { name = "JWT_PUBLIC_KEY",      secret_arn = module.secrets.secret_arns["jwt-public-key"] },
    { name = "COOKIE_SECRET",       secret_arn = module.secrets.secret_arns["cookie-secret"] },
    { name = "ENTRA_CLIENT_SECRET", secret_arn = module.secrets.secret_arns["entra-client-secret"] },
    { name = "VALKEY_URL",          secret_arn = module.secrets.secret_arns["valkey-url"] },
  ]
  environment_vars = [
    { name = "NODE_ENV",          value = "production" },
    { name = "PORT",              value = "3000" },
    { name = "AWS_REGION",        value = local.region },
    { name = "SQS_OUTBOX_URL",    value = module.messaging.queue_urls["outbox"] },
    { name = "S3_UPLOAD_BUCKET",  value = aws_s3_bucket.uploads.id },
    { name = "ENTRA_TENANT_ID",   value = var.entra_tenant_id },
    { name = "ENTRA_CLIENT_ID",   value = var.entra_client_id },
    { name = "CORS_ORIGINS",      value = "https://app-dev.opshub.qnsc.vn" },
    { name = "APP_URL",           value = "https://app-dev.opshub.qnsc.vn" },
  ]

  sqs_queue_arns = values(module.messaging.queue_arns)
  sns_topic_arns = values(module.messaging.topic_arns)
  s3_bucket_arns = [aws_s3_bucket.uploads.arn]

  tags = { Environment = local.env, Service = "api", AutoStop = "true" }
}

# ── Worker service ────────────────────────────────────────────────────────────
module "worker" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/ecs-service?ref=ecs-service-v1.1.0"

  service_name = "worker"
  cluster_name = module.ecs_cluster.cluster_name
  cluster_arn  = module.ecs_cluster.cluster_arn
  region       = local.region
  image_uri    = local.ecr_worker_url

  cpu    = 256
  memory = 512

  vpc_id            = module.network.vpc_id
  subnet_ids        = module.network.private_subnet_ids
  security_group_id = module.network.sg_app_id

  desired_count      = 1
  min_count          = 1
  max_count          = 2
  use_spot           = true # Fargate Spot: saves ~70% on compute
  log_retention_days = 7    # dev: 7 days sufficient for debugging

  attach_alb = false

  secret_arns = values(module.secrets.secret_arns)
  kms_key_arn = local.kms_key_arn
  secrets = [
    { name = "DATABASE_URL",        secret_arn = module.secrets.secret_arns["db-url"] },
    { name = "JWT_PRIVATE_KEY",     secret_arn = module.secrets.secret_arns["jwt-private-key"] },
    { name = "JWT_PUBLIC_KEY",      secret_arn = module.secrets.secret_arns["jwt-public-key"] },
    { name = "COOKIE_SECRET",       secret_arn = module.secrets.secret_arns["cookie-secret"] },
    { name = "ENTRA_CLIENT_SECRET", secret_arn = module.secrets.secret_arns["entra-client-secret"] },
    { name = "VALKEY_URL",          secret_arn = module.secrets.secret_arns["valkey-url"] },
  ]
  environment_vars = [
    { name = "NODE_ENV",          value = "production" },
    { name = "AWS_REGION",        value = local.region },
    { name = "SQS_OUTBOX_URL",    value = module.messaging.queue_urls["outbox"] },
    { name = "S3_UPLOAD_BUCKET",  value = aws_s3_bucket.uploads.id },
    { name = "ENTRA_TENANT_ID",   value = var.entra_tenant_id },
    { name = "ENTRA_CLIENT_ID",   value = var.entra_client_id },
  ]

  sqs_queue_arns = values(module.messaging.queue_arns)
  sns_topic_arns = values(module.messaging.topic_arns)
  s3_bucket_arns = [aws_s3_bucket.uploads.arn]

  tags = { Environment = local.env, Service = "worker", AutoStop = "true" }
}

# ── WAF (disabled in dev — saves $5+/month per WebACL) ───────────────────────
module "waf" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/waf?ref=waf-v1.0.1"

  name                = local.name
  enabled             = false
  alb_arn             = module.alb.arn
  rate_limit_per_5min = 2000

  tags = { Environment = local.env }
}

# ── CloudFront → ALB HTTP forward rule for /v1/* ─────────────────────────────
# CloudFront connects to the ALB on HTTP (port 80) to avoid TLS SNI mismatch
# between the CloudFront origin request (raw ELB hostname) and the ACM cert
# issued for the custom API domain. This rule accepts those HTTP requests and
# forwards /v1/* to the API target group; all other paths remain HTTP→HTTPS redirect.
resource "aws_lb_listener_rule" "http_api_forward" {
  listener_arn = module.alb.http_listener_arn
  priority     = 1

  action {
    type             = "forward"
    target_group_arn = module.api.target_group_arn
  }

  condition {
    path_pattern {
      values = ["/v1/*"]
    }
  }
}

# ── CDN (S3 + CloudFront) — opshub-web SPA ────────────────────────────────────
module "cdn" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/cdn?ref=cdn-v1.0.3"

  name                   = "opshub-web-develop"
  acm_cert_arn           = var.web_acm_cert_arn
  aliases                = []
  price_class            = "PriceClass_100" # develop: US/EU PoPs only — cheaper than PriceClass_200
  api_origin_domain_name = module.alb.dns_name

  tags = { Environment = local.env, Service = "web" }
}

# ── Dev scheduler: stop RDS + scale ECS to 0 off-hours ───────────────────────
# Tag-driven: acts on resources tagged AutoStop=true.
# Stops at 8pm ICT, restarts at 8am ICT weekdays.
module "dev_scheduler" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/dev-scheduler?ref=dev-scheduler-v1.0.0"
  name   = local.name
  tags   = { Environment = local.env }
}
