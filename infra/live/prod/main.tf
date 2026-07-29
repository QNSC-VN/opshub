// opshub · production
//
// Thin by design: the stack lives in ../../modules/stack, so this environment can only
// differ from develop in the values below. Production takes the durable settings —
// on-demand capacity, deletion protection, 90-day retention, a real secret recovery
// window.
//
// NOT YET APPLIED. There is no `opshub/prod/terraform.tfstate`, so this file describes
// the environment that the first v*.*.* tag will create. The go-live checklist on the
// `rds` block below is part of that first apply, not a later hardening pass.
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

provider "cloudflare" {
  api_token = var.cloudflare_api_token != "" ? var.cloudflare_api_token : null
}

locals {
  region = "ap-southeast-1"
}

// ── The stack ─────────────────────────────────────────────────────────────────
module "stack" {
  source = "../../modules/stack"

  product = "opshub"
  env     = "production"
  // Resources are named `opshub-prod`, not `opshub-production`: renaming them later
  // would force replacement of the cluster, the RDS instance and every log group.
  env_slug = "prod"
  region   = local.region

  app_domain = "opshub.qnsc.vn"
  api_domain = "opshub-api.qnsc.vn"
  web_record = "opshub"
  api_record = "opshub-api"

  shared_state_key  = "opshub/shared/terraform.tfstate"
  runtime_state_key = "platform/runtime-prod/terraform.tfstate"

  // The tag that triggered the apply, never a floating `latest` — infra-apply.yml
  // passes github.ref_name, so an infra apply can never quietly move production onto
  // a different image than the release it belongs to.
  image_tag = var.image_tag

  entra_tenant_id = var.entra_tenant_id
  entra_client_id = var.entra_client_id

  // 90 days is the SOC 2 minimum; the recovery window keeps a mistaken destroy
  // recoverable.
  log_retention_days           = 90
  secrets_recovery_window_days = 30

  // OFF, including here. Nothing in this product reads the ECS/ContainerInsights
  // namespace: the autoscaling targets read AWS/ECS, which is free and published
  // whether Container Insights is on or off, and application telemetry goes to OTLP.
  // Raise it to "enhanced" temporarily during an incident that needs per-container
  // drilldown, then put it back.
  container_insights = "disabled"

  // PRE-LAUNCH sizing. Multi-AZ with Enhanced Monitoring is the right production
  // posture, and it is what this becomes at go-live — but Multi-AZ doubles the
  // instance rate AND bills the mirrored volume, so paying for it before the first
  // user buys durability for an empty database.
  //
  // GO-LIVE CHECKLIST — flip these together, before the first real user:
  //     instance_class      = "db.t4g.small"  # 2 GB rather than 1 GB
  //     multi_az            = true            # an AZ failure becomes a failover,
  //                                           # not an outage plus a restore
  //     monitoring_interval = 60              # per-process and per-device visibility
  //
  // 30 GB, not 100: `max_allocated_storage_gb` already autoscales, and RDS gp3 gives
  // the same 3,000 baseline IOPS at every size under 400 GB, so over-allocating buys
  // nothing. Treat any increase as PERMANENT — RDS refuses to shrink a volume and a
  // snapshot restore cannot land smaller, so coming back down needs the instance
  // replaced.
  rds = {
    instance_class           = "db.t4g.micro"
    allocated_storage_gb     = 30
    max_allocated_storage_gb = 500
    multi_az                 = false
    deletion_protection      = true
    backup_retention_days    = 30
    monitoring_interval      = 0
  }

  // On-demand, not Spot: an interruption here is user-visible. Tighter autoscale
  // targets than develop, so it scales out earlier.
  api = {
    cpu               = 1024
    memory            = 2048
    max_count         = 6
    use_spot          = false
    cpu_target_pct    = 60
    memory_target_pct = 70
  }

  worker = {
    cpu       = 512
    memory    = 1024
    max_count = 4
    use_spot  = false
  }

  // `force_destroy` stays false and no extra CORS origin is allowed: production
  // uploads are never auto-deleted, and only the SPA's own origin may PUT.
  uploads = {}

  cloudflare_account_id = var.cloudflare_account_id
}
