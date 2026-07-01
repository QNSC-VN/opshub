variable "repositories" {
  type    = list(string)
  default = ["opshub-api", "opshub-worker"]
}
variable "kms_key_arn" {
  type        = string
  default     = ""
  description = "KMS key ARN for ECR encryption. Empty = AWS managed AES256."
}
variable "tags" {
  type    = map(string)
  default = {}
}
