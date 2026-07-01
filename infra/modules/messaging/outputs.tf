output "queue_arns" {
  value = {
    outbox     = aws_sqs_queue.outbox.arn
    outbox-dlq = aws_sqs_queue.outbox_dlq.arn
  }
}
output "outbox_queue_url" { value = aws_sqs_queue.outbox.url }
output "topic_arns" {
  value = { events = aws_sns_topic.events.arn }
}
