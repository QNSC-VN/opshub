# opshub

Internal IT/HR operations platform (**Zone B2 — internal**, not internet-exposed by default). Runs on **ECS Fargate**, per the [platform architecture](https://github.com/QNSC-VN/.github/blob/main/docs/PLATFORM_ARCHITECTURE.md).

> **Monorepo.** Consolidates the former `opshub-api` + `opshub-web` + `opshub-infra` into one repository per [REPOSITORY_STRUCTURE.md](https://github.com/QNSC-VN/.github/blob/main/docs/REPOSITORY_STRUCTURE.md) (ADR-R1). Old repos archived (read-only) for history.

## Layout

```
opshub/
├── apps/{api,worker,web}/   # NestJS api + worker (ECS Fargate); Vite SPA (S3+CloudFront)
├── libs/                    # shared backend libs (== design's "packages/", NestJS convention)
├── db/                      # Drizzle schema + migrations
├── deploy/ecs/              # deploy-descriptor notes (task-def is infra-owned)
├── infra/                   # OpenTofu (product-owned resources)
│   ├── live/{_shared,develop,prod}/
│   └── modules/             # LOCAL modules (see KNOWN ISSUES — dedup to qnsc-tf-modules pending)
├── .github/workflows/       # CI/CD → QNSC-VN/qnsc-ci
└── Dockerfile               # multi-target: api, worker, migrator
```

Workspace model, develop, build, and deploy conventions mirror [`rally`](https://github.com/QNSC-VN/rally): NestJS backend is the pnpm root, `apps/web` is a workspace member; deploy is push-based to ECS via `qnsc-ci`.

## ⚠️ Known issues (pre-existing, carried from opshub-api — NOT introduced by consolidation)

1. **License module does not compile (4 errors).** `db/schema/licenses.ts` + `libs/modules/license` import `licenseTypeEnum` / `licenseStatusEnum`, but those enums were never defined in `db/schema/enums.ts`. A commented TODO stub is in `enums.ts` — **product must confirm the enum value set**, then uncomment. Until then the backend build fails on the license module only.
2. **infra/modules/ are local copies**, not the shared `qnsc-tf-modules`. They have diverged from the shared modules, so migrating is not a mechanical source-swap — it needs interface reconciliation + `tofu plan` validation. Tracked as a follow-up.
3. Stray compiled `.js`/`.js.map` files exist beside some `db/schema/*.ts` — should be cleaned and gitignored.

The consolidation itself is faithful (identical file counts to source) and the Dockerfile now exposes the `api`/`worker`/`migrator` targets the CI expects (previously missing).
