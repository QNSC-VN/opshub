// Relocation map for the stack extraction.
//
// Every address below moved from the root of this stack into `module.stack`. Without
// these blocks Terraform reads the change as "destroy 58 resources, create 58 almost
// identical ones" — including the RDS instance, the ECS cluster and the upload bucket.
// With them it simply relabels state, and the whole plan reduces to seven intended
// changes: the cache node and its subnet group are created, the three task definitions
// are replaced (the Valkey sidecars leave and VALKEY_URL points at the new node), the
// cluster turns Container Insights off, and the SNS topic moves onto the shared CMK.
//
// Only develop needs this file. Production has never been applied — there is no
// `opshub/prod/terraform.tfstate` object — so it has nothing to relocate, and a moved
// block there would be permanently inert.
//
// Safe to delete once develop has applied.

moved {
  from = module.secrets
  to   = module.stack.module.secrets
}

moved {
  from = module.rds
  to   = module.stack.module.rds
}

moved {
  from = module.messaging
  to   = module.stack.module.messaging
}

moved {
  from = module.app_bucket
  to   = module.stack.module.app_bucket
}

moved {
  from = module.ecs_cluster
  to   = module.stack.module.ecs_cluster
}

moved {
  from = module.api
  to   = module.stack.module.api
}

moved {
  from = module.worker
  to   = module.stack.module.worker
}

moved {
  from = module.migrator
  to   = module.stack.module.migrator
}

moved {
  from = module.web
  to   = module.stack.module.web
}

// The API's Cloudflare record. Cloudflare rejects a CREATE for a name that already
// exists, so for this address a missing moved block is a FAILED apply rather than
// merely a destroy-and-recreate.
moved {
  from = module.dns_api
  to   = module.stack.module.dns_api
}
