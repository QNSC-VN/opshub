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
