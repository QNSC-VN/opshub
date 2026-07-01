# Outbox relay target queue + dead-letter queue.
resource "aws_sqs_queue" "outbox_dlq" {
  name                      = "${var.prefix}-outbox-dlq"
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true
  tags                      = var.tags
}

resource "aws_sqs_queue" "outbox" {
  name                       = "${var.prefix}-outbox"
  visibility_timeout_seconds = 60
  message_retention_seconds  = 345600
  sqs_managed_sse_enabled    = true
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.outbox_dlq.arn
    maxReceiveCount     = 5
  })
  tags = var.tags
}

resource "aws_sns_topic" "events" {
  name              = "${var.prefix}-events"
  kms_master_key_id = "alias/aws/sns"
  tags              = var.tags
}
