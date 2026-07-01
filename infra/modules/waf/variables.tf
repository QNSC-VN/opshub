variable "name"    { type = string }
variable "enabled" {
  type = bool
  default = true
  description = "Set false in develop to skip WAF (saves $5+/month per WebACL)"
}
variable "alb_arn" { type = string }
variable "rate_limit" {
  type    = number
  default = 2000
}
variable "tags" {
  type    = map(string)
  default = {}
}
