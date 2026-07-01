variable "prefix" { type = string }
variable "secret_names" {
  type    = list(string)
  default = ["db-url", "jwt-secret"]
}
variable "tags" {
  type    = map(string)
  default = {}
}
