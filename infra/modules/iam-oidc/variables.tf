variable "oidc_provider_arn" {
  type        = string
  description = "ARN of the GitHub OIDC provider from qnsc-infra bootstrap."
}
variable "github_org" { type = string }
variable "github_repos" {
  type    = list(string)
  default = ["opshub-api", "opshub-web", "opshub-infra"]
}
variable "role_name" {
  type    = string
  default = "opshub-github-deploy"
}
variable "ecr_arns" {
  type    = list(string)
  default = ["*"]
}
variable "tags" {
  type    = map(string)
  default = {}
}
