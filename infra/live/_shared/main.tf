terraform {
  required_version = ">= 1.9"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }

  backend "s3" {
    bucket         = "qnsc-tofu-state"
    key            = "opshub/shared/terraform.tfstate"
    region         = "ap-southeast-1"
    encrypt        = true
    dynamodb_table = "qnsc-tofu-locks"
  }
}

provider "aws" {
  region = "ap-southeast-1"
  default_tags {
    tags = {
      Project   = "opshub"
      Scope     = "shared"
      ManagedBy = "opentofu"
    }
  }
}

# github_org is declared in variables.tf (with a QNSC-VN default).

# ── Platform remote state (OIDC provider ARN + KMS from qnsc-infra) ───────────
data "terraform_remote_state" "platform" {
  backend = "s3"
  config = {
    bucket = "qnsc-tofu-state"
    key    = "platform/bootstrap/terraform.tfstate"
    region = "ap-southeast-1"
  }
}

# ── Container registries ──────────────────────────────────────────────────────
module "ecr" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/ecr?ref=ecr-v1.1.0"

  repository_names     = ["opshub-api", "opshub-worker", "opshub-migrator"]
  image_tag_mutability = "MUTABLE" # allows re-tagging :latest
  kms_key_arn          = data.terraform_remote_state.platform.outputs.kms_key_arn
  tags                 = { Scope = "shared" }
}

# ── GitHub Actions OIDC roles (ECS deploy + ECR push + infra CI) ─────────────
# Owns ALL opshub deploy roles: API (per-env), ECR push, infra plan/apply, AND
# web (SPA) deploy roles (previously hand-rolled below — now the module's
# web_deploy_environments input). opshub is a monorepo; subjects use the
# "opshub" repo (the archived "opshub-api"/"opshub-web" split repos are dead).
module "iam_oidc" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/iam-oidc?ref=iam-oidc-v1.2.0"

  product           = "opshub"
  github_org        = var.github_org
  oidc_provider_arn = data.terraform_remote_state.platform.outputs.oidc_provider_arn

  environments = {
    develop = {
      allowed_subjects = [
        "repo:${var.github_org}/opshub:ref:refs/heads/main",
        "repo:${var.github_org}/opshub:environment:develop",
      ]
    }
    production = {
      allowed_subjects = [
        "repo:${var.github_org}/opshub:ref:refs/heads/main",
        "repo:${var.github_org}/opshub:ref:refs/tags/v*",
        "repo:${var.github_org}/opshub:environment:production",
      ]
    }
  }

  web_deploy_environments = {
    develop = {
      allowed_subjects = [
        "repo:${var.github_org}/opshub:ref:refs/heads/main",
        "repo:${var.github_org}/opshub:environment:develop",
      ]
      s3_bucket = "opshub-web-develop"
    }
    production = {
      allowed_subjects = [
        "repo:${var.github_org}/opshub:ref:refs/heads/main",
        "repo:${var.github_org}/opshub:ref:refs/tags/v*",
        "repo:${var.github_org}/opshub:environment:production",
      ]
      s3_bucket = "opshub-web-prod"
    }
  }

  app_repo_names         = ["opshub"]
  infra_repo_name        = "opshub"
  ecr_repository_pattern = "opshub-*"
  ecs_passrole_pattern   = "opshub-*"

  tags = { Scope = "shared" }
}

# ── RDS dev-cost-saver guard — develop deploy role only ──────────────────────
# Allows the CI deploy job to detect + start a stopped RDS instance before
# running migrations. Scoped to develop only; prod RDS is always-on and this
# permission is intentionally absent from the production deploy role.
#
# The ARN is constructed directly (account_id + region + fixed identifier)
# instead of via a `data "aws_db_instance"` lookup. A data-source lookup
# fails hard whenever the instance doesn't exist yet or has been torn down
# (e.g. a fresh deploy, or a full teardown+redeploy cycle) — this stack
# would then be unable to apply/destroy independently of develop's RDS
# lifecycle. An ARN string doesn't require the resource to exist.
data "aws_caller_identity" "current" {}

locals {
  opshub_develop_rds_arn = "arn:aws:rds:ap-southeast-1:${data.aws_caller_identity.current.account_id}:db:opshub-develop"
}

resource "aws_iam_role_policy" "deploy_rds_dev_guard" {
  name = "opshub-deploy-develop-rds-guard"
  role = split("/", module.iam_oidc.deploy_role_arns["develop"])[1]

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "RDSDevGuard"
        Effect = "Allow"
        Action = [
          "rds:DescribeDBInstances",
          "rds:StartDBInstance",
        ]
        Resource = local.opshub_develop_rds_arn
      }
    ]
  })
}

# ── ECS deploy verification — both deploy roles ────────────────────────────
# verify-ecs-deploy enumerates running tasks (aws ecs list-tasks) to confirm the
# new image tag is live after a deploy. Without ecs:ListTasks the call is denied,
# the action swallows the error, and verification always times out. The baseline
# iam-oidc module (main / next release) grants this, but this stack still pins
# iam-oidc-v1.2.0 — adopting the newer module also changes the infra-apply OIDC
# trust, so we grant it here (both envs) until that bump is done deliberately.
resource "aws_iam_role_policy" "deploy_ecs_verify" {
  for_each = toset(["develop", "production"])

  name = "opshub-deploy-${each.key}-ecs-verify"
  role = split("/", module.iam_oidc.deploy_role_arns[each.key])[1]

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ECSVerifyListTasks"
        Effect   = "Allow"
        Action   = ["ecs:ListTasks"]
        Resource = "*"
      }
    ]
  })
}
