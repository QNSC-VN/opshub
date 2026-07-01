terraform {
  required_version = ">= 1.9"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
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
      Environment = "prod"
      ManagedBy   = "opentofu"
    }
  }
}

data "aws_caller_identity" "current" {}

# ── Read shared layer outputs (OIDC ARN, KMS ARN, artifacts bucket) ───────────
data "terraform_remote_state" "shared" {
  backend = "s3"
  config = {
    bucket = "qnsc-tofu-state"
    key    = "opshub/shared/terraform.tfstate"
    region = "ap-southeast-1"
  }
}

locals {
  env    = "prod"
  name   = "opshub-prod"
  region = "ap-southeast-1"
  azs    = ["ap-southeast-1a", "ap-southeast-1b", "ap-southeast-1c"]

  kms_key_arn = data.terraform_remote_state.shared.outputs.kms_key_arn

  ecr_base       = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${local.region}.amazonaws.com"
  ecr_api_url    = "${local.ecr_base}/opshub-api:${var.image_tag}"
  ecr_worker_url = "${local.ecr_base}/opshub-worker:${var.image_tag}"

  # Cloudflare IPv4 ranges — https://cloudflare.com/ips-v4 (update if Cloudflare publishes new ranges)
  cloudflare_ipv4 = [
    "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22",
    "103.31.4.0/22",   "141.101.64.0/18", "108.162.192.0/18",
    "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22",
    "198.41.128.0/17", "162.158.0.0/15",  "104.16.0.0/13",
    "104.24.0.0/14",   "172.64.0.0/13",   "131.0.72.0/22",
  ]
}

# ── Networking (HA NAT) ───────────────────────────────────────────────────────
module "network" {
  source = "../../modules/network"

  name                 = local.name
  region               = local.region
  azs                  = local.azs
  vpc_cidr             = "10.30.0.0/16"
  public_subnet_cidrs  = ["10.30.0.0/24", "10.30.1.0/24", "10.30.2.0/24"]
  private_subnet_cidrs = ["10.30.10.0/24", "10.30.11.0/24", "10.30.12.0/24"]
  data_subnet_cidrs    = ["10.30.20.0/24", "10.30.21.0/24", "10.30.22.0/24"]
  multi_az_nat         = true
  app_port             = 3000
  enable_flow_logs     = true
  alb_ingress_cidrs    = local.cloudflare_ipv4  # lock ALB to Cloudflare orange-cloud proxy IPs
  tags                 = { Environment = local.env }
}

module "secrets" {
  source       = "../../modules/secrets"
  prefix       = "opshub/${local.env}"
  kms_key_arn  = local.kms_key_arn
  secret_names = [
    "db-url",
    "jwt-secret",
    "entra-client-secret",
    "valkey-url",
  ]
  tags = { Environment = local.env }
}

# ── S3 upload bucket ─────────────────────────────────────────────────────────
resource "aws_s3_bucket" "uploads" {
  bucket        = "opshub-${local.env}-uploads"
  force_destroy = false
  tags          = { Name = "opshub-${local.env}-uploads", Environment = local.env }
}

resource "aws_s3_bucket_versioning" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = local.kms_key_arn
    }
    bucket_key_enabled = true   # reduces KMS request costs by ~99%
  }
}

resource "aws_s3_bucket_public_access_block" "uploads" {
  bucket                  = aws_s3_bucket.uploads.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
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
    allowed_origins = ["https://app.opshub.qnsc.vn"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3600
  }
}

# ── ElastiCache Serverless (Valkey) ──────────────────────────────────────────
resource "aws_elasticache_serverless_cache" "valkey" {
  engine = "valkey"
  name   = "${local.name}-valkey"

  cache_usage_limits {
    data_storage {
      maximum = 5
      unit    = "GB"
    }
    ecpu_per_second {
      maximum = 5000
    }
  }

  subnet_ids         = module.network.data_subnet_ids
  security_group_ids = [module.network.sg_elasticache_id]
  tags               = { Name = "${local.name}-valkey", Environment = local.env }
}

# ── RDS PostgreSQL 18 (Multi-AZ, protected) ───────────────────────────────────
module "rds" {
  source = "../../modules/rds"

  identifier               = local.name
  subnet_ids               = module.network.data_subnet_ids
  security_group_id        = module.network.sg_rds_id
  kms_key_arn              = local.kms_key_arn
  instance_class           = "db.r7g.large"
  allocated_storage_gb     = 100
  max_allocated_storage_gb = 500
  multi_az                 = true
  deletion_protection      = true
  backup_retention_days    = 30
  tags                     = { Environment = local.env }
}

module "messaging" {
  source = "../../modules/messaging"
  prefix = local.name
  tags   = { Environment = local.env }
}

# ── ALB ───────────────────────────────────────────────────────────────────────
resource "aws_lb" "this" {
  name                       = local.name
  internal                   = false
  load_balancer_type         = "application"
  security_groups            = [module.network.sg_alb_id]
  subnets                    = module.network.public_subnet_ids
  enable_deletion_protection = true
  drop_invalid_header_fields = true
  tags                       = { Name = local.name, Environment = local.env }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.acm_cert_arn

  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "Not found"
      status_code  = "404"
    }
  }
}

resource "aws_lb_listener" "http_redirect" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

# ── ECR repositories ─────────────────────────────────────────────────────────
module "ecr" {
  source       = "../../modules/ecr"
  repositories = ["opshub-api", "opshub-worker", "opshub-migrator"]
  tags         = { Environment = local.env }
}

module "ecs_cluster" {
  source = "../../modules/ecs-cluster"
  name   = local.name
  tags   = { Environment = local.env }
}

# ── API service ───────────────────────────────────────────────────────────────
module "api" {
  source = "../../modules/ecs-service"

  service_name = "api"
  cluster_name = module.ecs_cluster.cluster_name
  cluster_arn  = module.ecs_cluster.cluster_arn
  image_uri    = local.ecr_api_url
  region       = local.region

  cpu            = 1024
  memory         = 2048
  container_port = 3000

  vpc_id            = module.network.vpc_id
  subnet_ids        = module.network.private_subnet_ids
  security_group_id = module.network.sg_app_id

  desired_count = 2
  min_count     = 2
  max_count     = 6

  attach_alb        = true
  alb_listener_arn  = aws_lb_listener.https.arn
  alb_priority      = 100
  alb_path_patterns = ["/*"]
  health_check_path = "/v1/healthz"

  secret_arns = values(module.secrets.secret_arns)
  secrets = [
    { name = "DATABASE_URL",        secret_arn = module.secrets.secret_arns["db-url"] },
    { name = "JWT_SECRET",          secret_arn = module.secrets.secret_arns["jwt-secret"] },
    { name = "ENTRA_CLIENT_SECRET", secret_arn = module.secrets.secret_arns["entra-client-secret"] },
    { name = "VALKEY_URL",          secret_arn = module.secrets.secret_arns["valkey-url"] },
  ]
  environment_vars = [
    { name = "NODE_ENV",          value = "production" },
    { name = "PORT",              value = "3000" },
    { name = "AWS_REGION",        value = local.region },
    { name = "SQS_OUTBOX_URL",    value = module.messaging.outbox_queue_url },
    { name = "S3_UPLOAD_BUCKET",  value = aws_s3_bucket.uploads.id },
  ]

  sqs_queue_arns    = values(module.messaging.queue_arns)
  sns_topic_arns    = values(module.messaging.topic_arns)
  s3_bucket_arns    = [aws_s3_bucket.uploads.arn]
  cpu_target_pct    = 60   # tighter than default 70 — scales out earlier in prod
  memory_target_pct = 70
  log_retention_days = 90  # SOC 2 minimum for prod logs
  tags              = { Environment = local.env, Service = "api" }
}

# ── Worker service ────────────────────────────────────────────────────────────
module "worker" {
  source = "../../modules/ecs-service"

  service_name = "worker"
  cluster_name = module.ecs_cluster.cluster_name
  cluster_arn  = module.ecs_cluster.cluster_arn
  image_uri    = local.ecr_worker_url
  region       = local.region

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
  secrets = [
    { name = "DATABASE_URL",        secret_arn = module.secrets.secret_arns["db-url"] },
    { name = "JWT_SECRET",          secret_arn = module.secrets.secret_arns["jwt-secret"] },
    { name = "ENTRA_CLIENT_SECRET", secret_arn = module.secrets.secret_arns["entra-client-secret"] },
    { name = "VALKEY_URL",          secret_arn = module.secrets.secret_arns["valkey-url"] },
  ]
  environment_vars = [
    { name = "NODE_ENV",          value = "production" },
    { name = "AWS_REGION",        value = local.region },
    { name = "SQS_OUTBOX_URL",    value = module.messaging.outbox_queue_url },
    { name = "S3_UPLOAD_BUCKET",  value = aws_s3_bucket.uploads.id },
  ]

  sqs_queue_arns     = values(module.messaging.queue_arns)
  sns_topic_arns     = values(module.messaging.topic_arns)
  s3_bucket_arns     = [aws_s3_bucket.uploads.arn]
  log_retention_days = 90
  tags               = { Environment = local.env, Service = "worker" }
}

module "waf" {
  source     = "../../modules/waf"
  name       = local.name
  alb_arn    = aws_lb.this.arn
  rate_limit = 5000
  tags       = { Environment = local.env }
}

# ── CDN (S3 + CloudFront) — opshub-web SPA ────────────────────────────────────
module "cdn" {
  source       = "../../modules/cdn"
  name         = "opshub-web-prod"
  acm_cert_arn = var.web_acm_cert_arn
  aliases      = []   # set to ["app.opshub.qnsc.vn"] once DNS is configured
  price_class  = "PriceClass_All"   # global coverage for production
  tags         = { Environment = local.env, Service = "web" }
}
