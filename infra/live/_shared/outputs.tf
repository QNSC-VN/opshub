output "ecr_repository_urls"    { value = module.ecr.repository_urls }

# Per-environment app deploy role ARNs — update GitHub Actions secrets when these change.
# develop:    OPSHUB_DEPLOY_ROLE_ARN (in the "develop" environment)
# production: OPSHUB_DEPLOY_ROLE_ARN (in the "production" environment)
output "deploy_role_arns" {
  value       = module.iam_oidc.deploy_role_arns
  description = "Map of env → deploy role ARN. Update GitHub Actions environment secrets."
}

output "ecr_push_role_arn"       { value = module.iam_oidc.ecr_push_role_arn }
output "infra_plan_role_arn"     { value = module.iam_oidc.infra_plan_role_arn }
output "infra_apply_role_arn"    { value = module.iam_oidc.infra_apply_role_arn }

output "web_deploy_role_arns"    { value = { for k, v in aws_iam_role.web_deploy : k => v.arn } }

# ── Re-exported from qnsc-infra platform layer ────────────────────────────────
output "kms_key_arn" {
  value       = data.terraform_remote_state.platform.outputs.kms_key_arn
  description = "Shared CMK ARN from qnsc-infra — pass to RDS and Secrets modules"
}

output "artifacts_bucket_name" {
  value       = data.terraform_remote_state.platform.outputs.artifacts_bucket_name
  description = "Shared artifacts bucket from qnsc-infra — use in publish-openapi-spec CI"
}
