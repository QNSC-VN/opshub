variable "identifier" { type = string }
variable "subnet_ids" { type = list(string) }
variable "security_group_id" { type = string }
variable "engine_version" {
  type    = string
  default = "18.0"
}
variable "instance_class" {
  type    = string
  default = "db.t4g.medium"
}
variable "allocated_storage_gb" {
  type    = number
  default = 20
}
variable "max_allocated_storage_gb" {
  type    = number
  default = 100
}
variable "multi_az" {
  type    = bool
  default = false
}
variable "deletion_protection" {
  type    = bool
  default = false
}
variable "backup_retention_days" {
  type    = number
  default = 3
}
variable "db_name" {
  type    = string
  default = "opshub"
}
variable "master_username" {
  type    = string
  default = "opshub_admin"
}
variable "tags" {
  type    = map(string)
  default = {}
}
