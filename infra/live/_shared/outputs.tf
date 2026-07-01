output "ecr_repository_urls"    { value = module.ecr.repository_urls }
output "deploy_role_arn"         { value = module.iam_oidc.deploy_role_arn }
output "web_deploy_role_arns"    { value = { for k, v in aws_iam_role.web_deploy : k => v.arn } }

# ── Re-exported from qnsc-infra platform layer ────────────────────────────────
# Env stacks read from this shared state instead of going directly to qnsc-infra.
output "kms_key_arn" {
  value       = data.terraform_remote_state.platform.outputs.kms_key_arn
  description = "Shared CMK ARN from qnsc-infra — pass to RDS and Secrets modules"
}

output "artifacts_bucket_name" {
  value       = data.terraform_remote_state.platform.outputs.artifacts_bucket_name
  description = "Shared artifacts bucket from qnsc-infra — use in publish-openapi-spec CI"
}
