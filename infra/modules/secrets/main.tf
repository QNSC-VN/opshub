# Provisions empty Secrets Manager containers. Values are filled out-of-band
# (console / CI), never committed to state.
resource "aws_secretsmanager_secret" "this" {
  for_each = toset(var.secret_names)
  name     = "${var.prefix}/${each.value}"
  tags     = merge(var.tags, { Name = "${var.prefix}/${each.value}" })
}
