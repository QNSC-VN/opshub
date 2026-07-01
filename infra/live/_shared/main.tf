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

variable "github_org" {
  type        = string
  description = "GitHub org/owner that hosts the opshub repositories."
}

# ── Platform remote state (OIDC provider ARN from qnsc-infra) ──────────────
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
  source       = "../../modules/ecr"
  repositories = ["opshub-api", "opshub-worker"]
  kms_key_arn  = data.terraform_remote_state.platform.outputs.kms_key_arn
  tags         = { Scope = "shared" }
}

# ── GitHub OIDC deploy roles — opshub-web (S3 + CloudFront) ──────────────────
locals {
  github_org = var.github_org

  web_deploy_envs = {
    develop = {
      allowed_subjects = [
        "repo:${var.github_org}/opshub-web:ref:refs/heads/main",
      ]
      s3_bucket = "opshub-web-develop"
    }
    production = {
      allowed_subjects = [
        "repo:${var.github_org}/opshub-web:ref:refs/heads/main",
        "repo:${var.github_org}/opshub-web:ref:refs/tags/v*",
      ]
      s3_bucket = "opshub-web-prod"
    }
  }
}

data "aws_caller_identity" "current" {}

resource "aws_iam_role" "web_deploy" {
  for_each = local.web_deploy_envs

  name        = "opshub-github-web-deploy-${each.key}"
  description = "Assumed by GitHub Actions to deploy opshub-web to ${each.key}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = data.terraform_remote_state.platform.outputs.oidc_provider_arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
        StringLike = {
          "token.actions.githubusercontent.com:sub" = each.value.allowed_subjects
        }
      }
    }]
  })

  tags = { Scope = "shared", Environment = each.key }
}

resource "aws_iam_role_policy" "web_deploy" {
  for_each = local.web_deploy_envs

  name = "opshub-web-deploy-${each.key}"
  role = aws_iam_role.web_deploy[each.key].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "S3Sync"
        Effect = "Allow"
        Action = ["s3:PutObject", "s3:DeleteObject", "s3:GetObject", "s3:ListBucket"]
        Resource = [
          "arn:aws:s3:::${each.value.s3_bucket}",
          "arn:aws:s3:::${each.value.s3_bucket}/*",
        ]
      },
      {
        Sid      = "CloudFrontInvalidate"
        Effect   = "Allow"
        Action   = ["cloudfront:CreateInvalidation"]
        Resource = "arn:aws:cloudfront::${data.aws_caller_identity.current.account_id}:distribution/*"
      },
    ]
  })
}

# ── GitHub Actions OIDC deploy role (ECS/ECR) ─────────────────────────────────
module "iam_oidc" {
  source            = "../../modules/iam-oidc"
  github_org        = var.github_org
  oidc_provider_arn = data.terraform_remote_state.platform.outputs.oidc_provider_arn
  ecr_arns          = ["*"]
  tags              = { Scope = "shared" }
}
