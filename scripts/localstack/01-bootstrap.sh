#!/usr/bin/env bash
#
# LocalStack bootstrap — provisions the SQS queue and S3 bucket the OpsHub API
# and worker expect, so the outbox relay and file uploads can be exercised
# locally instead of silently no-op'ing.
#
# Runs automatically via the /etc/localstack/init/ready.d hook every time
# LocalStack becomes ready (mounted from ./scripts/localstack in
# docker-compose.dev.yml). Mirrors how db/init/ bootstraps Postgres.
#
# Idempotent: create-queue returns the existing queue, and create-bucket's
# BucketAlreadyOwnedByYou is swallowed explicitly, so re-runs are safe.
#
# Topology (mirrors module "messaging" / module "app_bucket" in
# infra/modules/stack/main.tf):
#
#   SQS opshub-outbox        — the outbox relay's SendMessage target
#     └─ redrives to opshub-outbox-dlq after MAX_RECEIVE failed receives
#
#   S3  opshub-files-dev     — every presigned upload (StorageService)
#
# WHAT IS DELIBERATELY ABSENT: the SNS topic. infra declares `topics = ["events"]`
# and grants both task roles publish on it, but no code publishes or subscribes
# yet. A topic with no publisher and no subscription exercises nothing, so it is
# left out rather than shipped as scaffolding — add it here (plus the SNS→SQS
# subscription with RawMessageDelivery=true) in the same change that adds the
# first publisher.
#
# Names, account and region are kept in sync with .env (AWS_REGION,
# SQS_OUTBOX_URL, S3_FILES_BUCKET). Changing one without the other means the app
# talks to a queue or bucket that does not exist.
set -euo pipefail

REGION="ap-southeast-1"
QUEUE_NAME="opshub-outbox"
BUCKET="opshub-files-dev"
# Receives before a message is redriven to the DLQ. 5 mirrors MAX_ATTEMPTS in
# apps/worker/src/outbox/outbox-relay.service.ts, which is the DB-side retry
# budget for the same event. NOTE: real AWS does not currently pin this — infra
# passes no `dlq_max_receive_count`, so the messaging module's default applies
# there until it does.
MAX_RECEIVE=5
# Vite dev-server origin — the SPA PUTs directly to the bucket from here.
WEB_ORIGIN="http://localhost:5173"

echo "[localstack-init] provisioning SQS…"

dlq="${QUEUE_NAME}-dlq"
# The DLQ's ARN is referenced by the main queue's redrive policy, so read it back
# from the queue we just created rather than hand-assembling an ARN string — a
# typo in a hand-built ARN produces a queue whose redrive silently targets
# nothing.
awslocal sqs create-queue --queue-name "$dlq" >/dev/null
dlq_arn="$(awslocal sqs get-queue-attributes \
  --queue-url "$(awslocal sqs get-queue-url --queue-name "$dlq" --output text --query 'QueueUrl')" \
  --attribute-names QueueArn --output text --query 'Attributes.QueueArn')"

# RedrivePolicy's value is itself a JSON string, so it must be escaped inside the
# --attributes JSON map (the shorthand form cannot express nested JSON).
# VisibilityTimeout 60 matches `queues = { outbox = { visibility_timeout = 60 } }`.
redrive="{\"deadLetterTargetArn\":\"${dlq_arn}\",\"maxReceiveCount\":\"${MAX_RECEIVE}\"}"
awslocal sqs create-queue \
  --queue-name "$QUEUE_NAME" \
  --attributes "{\"VisibilityTimeout\":\"60\",\"RedrivePolicy\":\"${redrive//\"/\\\"}\"}" \
  >/dev/null

echo "[localstack-init]   queue ready: $QUEUE_NAME (dlq: $dlq)"

echo "[localstack-init] provisioning S3…"

# create-bucket is not idempotent the way create-queue is: it returns
# BucketAlreadyOwnedByYou on re-run, which `set -e` would otherwise treat as
# fatal on every restart.
awslocal s3api create-bucket \
  --bucket "$BUCKET" \
  --region "$REGION" \
  --create-bucket-configuration "LocationConstraint=$REGION" \
  >/dev/null 2>&1 || true

# CORS mirrors the rules the app-bucket module applies in real AWS. Only
# Content-Type is listed because that is the only header StorageService signs
# into the presigned PUT (ContentLength is set by the browser automatically and
# is a forbidden header name, so CORS does not govern it). Signing a header the
# browser is not allowed to send fails every upload at preflight.
awslocal s3api put-bucket-cors --bucket "$BUCKET" --cors-configuration "{
  \"CORSRules\": [{
    \"AllowedMethods\": [\"PUT\", \"GET\", \"HEAD\"],
    \"AllowedOrigins\": [\"${WEB_ORIGIN}\"],
    \"AllowedHeaders\": [\"Content-Type\"],
    \"ExposeHeaders\": [\"ETag\"],
    \"MaxAgeSeconds\": 3600
  }]
}" >/dev/null

# Abort incomplete multipart uploads so abandoned uploads do not accrue storage.
awslocal s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" \
  --lifecycle-configuration '{
    "Rules": [{
      "ID": "abort-incomplete-multipart",
      "Status": "Enabled",
      "Filter": {"Prefix": ""},
      "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 7}
    }]
  }' >/dev/null

echo "[localstack-init]   bucket ready: $BUCKET"
echo "[localstack-init] done."
