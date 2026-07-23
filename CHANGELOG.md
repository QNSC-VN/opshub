# Changelog

## [0.1.2](https://github.com/QNSC-VN/opshub/compare/v0.1.1...v0.1.2) (2026-07-23)


### ✨ Features

* adopt [@qnsc-vn](https://github.com/qnsc-vn) shared cache and identity primitives (rebased [#37](https://github.com/QNSC-VN/opshub/issues/37)) ([#62](https://github.com/QNSC-VN/opshub/issues/62)) ([a3846e8](https://github.com/QNSC-VN/opshub/commit/a3846e83c1012b08e0cc6cf94a98615aa3bd3757))
* **infra:** give opshub prod its own dedicated cache node ([#66](https://github.com/QNSC-VN/opshub/issues/66)) ([86fb985](https://github.com/QNSC-VN/opshub/commit/86fb985f57afeb45c8933bb116b87cfbec0e7e28))


### 📦 Dependencies

* bump the production-dependencies group with 16 updates ([#47](https://github.com/QNSC-VN/opshub/issues/47)) ([acffb9b](https://github.com/QNSC-VN/opshub/commit/acffb9b7d4a8504969f4addf932afde400a5d3fa))

## [0.1.1](https://github.com/QNSC-VN/opshub/compare/v0.1.0...v0.1.1) (2026-07-18)


### ✨ Features

* **infra:** lock develop ALB ingress to Cloudflare IPs (dev/prod parity) ([59556af](https://github.com/QNSC-VN/opshub/commit/59556af8aab6ccbccebe7fdc997138e7978d9df8))
* **infra:** migrate develop to shared runtime (Option A) ([#23](https://github.com/QNSC-VN/opshub/issues/23)) ([cdcaf8f](https://github.com/QNSC-VN/opshub/commit/cdcaf8f7163e276011ee997390580eb5be1fe106))
* migrate opshub to Cloudflare Pages + converge with rally (dev bring-up) ([#16](https://github.com/QNSC-VN/opshub/issues/16)) ([c5a83bf](https://github.com/QNSC-VN/opshub/commit/c5a83bfa6e189cb0731acce89f48bfef14d36811))
* opshub monorepo — consolidate opshub-api + opshub-web + opshub-infra ([d2d286f](https://github.com/QNSC-VN/opshub/commit/d2d286fa30b5284fb8c05f12b97adc4f316b2ae8))


### 🐛 Bug Fixes

* **auth:** add authMethod to JWT and fix sign-out redirect routing ([c5ee352](https://github.com/QNSC-VN/opshub/commit/c5ee3524bf852ea41404d8604a62044dbca7b2dd))
* **auth:** make refresh-token rotation idempotent under concurrent reuse ([#36](https://github.com/QNSC-VN/opshub/issues/36)) ([a6e5693](https://github.com/QNSC-VN/opshub/commit/a6e5693cce51dd79ea91c4a2f4ba81080cbd5b99))
* **auth:** wire GRAPH_CLIENT_SECRET; drop unused ENTRA_CLIENT_SECRET ([#28](https://github.com/QNSC-VN/opshub/issues/28)) ([505523c](https://github.com/QNSC-VN/opshub/commit/505523c968780c2703f7dfacfe29e5f2f48df5f8))
* **cache:** connect Valkey eagerly so rate limiting works ([#34](https://github.com/QNSC-VN/opshub/issues/34)) ([8fd0d44](https://github.com/QNSC-VN/opshub/commit/8fd0d4470863b3588aa048503f441d508beb0797))
* **ci:** 3 critical workflow bugs ([8ae6f91](https://github.com/QNSC-VN/opshub/commit/8ae6f9136620323f5dbec142f1ecc96635e29800))
* **ci:** resolve migration --env-file failure and typecheck errors ([38b51ca](https://github.com/QNSC-VN/opshub/commit/38b51cad61b2cf03856e5c000892ba097685d35d))
* **ci:** Trivy scans, infra-plan exit-code logic ([bee1fc7](https://github.com/QNSC-VN/opshub/commit/bee1fc7217fe955b7fe6f9353a259ed0e4c38d6e))
* **ci:** trivy-action 0.37.0 → 0.36.0 (latest) ([1a9739b](https://github.com/QNSC-VN/opshub/commit/1a9739b317ed85cfbdfed58d9714992dc8d3f8be))
* **ci:** trivy-action tag needs v prefix (v0.36.0) ([d1b0205](https://github.com/QNSC-VN/opshub/commit/d1b02058bcfb3a55ddd9a6b0ef76d44ddecf4a1d))
* **config:** treat empty Entra SSO env vars as unset ([2a78aa0](https://github.com/QNSC-VN/opshub/commit/2a78aa04ecc7877b91431e880b197afe781c2017))
* correct stale infra/ path prefix and module version drift in CI ([d33607f](https://github.com/QNSC-VN/opshub/commit/d33607f7d8904f1a91621e3ca4ac128544a26a9e))
* **db:** add SSL handling for RDS + pre-compile migrator to eliminate CVEs ([6518914](https://github.com/QNSC-VN/opshub/commit/65189149c43fea20fa1c8a7ed9af7e658d13fd34))
* **db:** drop varchar default before enum type change in migrations 0006/0008 ([56a427c](https://github.com/QNSC-VN/opshub/commit/56a427c41d3789ab3ab8924db9dce54c06761134))
* **deploy:** grant ecs:ListTasks + wake ECS in dev deploy guard ([4d78d43](https://github.com/QNSC-VN/opshub/commit/4d78d430c12b435137d9629bcf40eb326c236f22))
* **dev:** unblock opshub dev deploy (fastify dedupe + web-deploy build) ([#19](https://github.com/QNSC-VN/opshub/issues/19)) ([d9973e1](https://github.com/QNSC-VN/opshub/commit/d9973e18edebeb03d5dc442de5a51c70db14ed5a))
* **identity:** cast RefreshToken row to domain type for authMethod narrowing ([b4d04e3](https://github.com/QNSC-VN/opshub/commit/b4d04e3096d0c412e034442739830e55c0ecaa54))
* **infra/prod:** align secrets, env vars, and CDN config with develop ([85a54e4](https://github.com/QNSC-VN/opshub/commit/85a54e4dfcbc8d573d9c96f64bc408cb581dab66))
* **infra:** bump dns-record to v1.1.0 to adopt orphan ([#25](https://github.com/QNSC-VN/opshub/issues/25)) ([33030aa](https://github.com/QNSC-VN/opshub/commit/33030aabc16daa4f1f8cdaf01e1b827cba2a7c95))
* **infra:** correct secret names, add missing env vars, wire API proxy ([8293e7f](https://github.com/QNSC-VN/opshub/commit/8293e7f64e8e147c4f4aad7bc019abcd17637dc1))
* **infra:** grant develop deploy role RDS dev-cost-saver guard ([#21](https://github.com/QNSC-VN/opshub/issues/21)) ([15fb540](https://github.com/QNSC-VN/opshub/commit/15fb5406dbdaaa5078f6d916fe4d87b5fb051959))
* **infra:** make opshub ECR repos MUTABLE ([#20](https://github.com/QNSC-VN/opshub/issues/20)) ([520b44d](https://github.com/QNSC-VN/opshub/commit/520b44d0dfaf6d35e27a44c1936a14a347cf02a5))
* **jwt:** replace symmetric JWT_SECRET with EC P-256 PEM keys in vitest ([fe859d2](https://github.com/QNSC-VN/opshub/commit/fe859d25cb6b53ccdf4eea4927dffc65c566697c))
* **license:** define licenseTypeEnum + licenseStatusEnum → clean build ([9d3a4a2](https://github.com/QNSC-VN/opshub/commit/9d3a4a2a5cd3c532c695a7f1d4a810fb17cd9b72))
* **lint:** resolve all pre-existing ESLint errors ([4b483d0](https://github.com/QNSC-VN/opshub/commit/4b483d07cb9be7173eeff879d153d28d0a8c176f))
* **opshub dev:** dedupe fastify to unblock backend build + fix web-deploy build cmd ([#17](https://github.com/QNSC-VN/opshub/issues/17)) ([81f2b5a](https://github.com/QNSC-VN/opshub/commit/81f2b5a133f49852c7017afc9f33d2409c66b6ed))
* **release:** emit vX.Y.Z tags so Release PR triggers deploy ([#49](https://github.com/QNSC-VN/opshub/issues/49)) ([335e28c](https://github.com/QNSC-VN/opshub/commit/335e28c2c4ae3b59c9494d5222e11b39c1c91b07))
* remove ScheduleModule from API, wire relay services to worker only ([afc105d](https://github.com/QNSC-VN/opshub/commit/afc105d0ad29e483de5fd77f379536ded9ceea8a))
* **security-posture:** register SecurityPostureSyncCron as a provider ([b61fd6b](https://github.com/QNSC-VN/opshub/commit/b61fd6bc7b18039ded4c4a9ea73abdafc30f6c27))
* **storage:** wire S3_FILES_BUCKET; drop unused S3_UPLOAD_BUCKET ([#29](https://github.com/QNSC-VN/opshub/issues/29)) ([52438a9](https://github.com/QNSC-VN/opshub/commit/52438a9539e403f2b68cf7b6e0f942b22a6ac502))
* **test:** add missing test scaffold and COOKIE_SECRET to vitest env ([b24983d](https://github.com/QNSC-VN/opshub/commit/b24983d37a38b2031826f9adbbfe91aadab85482))
* **test:** use explicit vi import, set coverage thresholds to current baseline ([5f8a120](https://github.com/QNSC-VN/opshub/commit/5f8a1204df52ec5b1b60c5fbcc39ca61411204eb))
* web-deploy IAM trust policy referenced archived opshub-web repo ([d0e6591](https://github.com/QNSC-VN/opshub/commit/d0e65914220ebe50ba60ff7b057e1990b5cad21e))
* **worker:** consolidate scheduled crons to worker process only ([8293e7f](https://github.com/QNSC-VN/opshub/commit/8293e7f64e8e147c4f4aad7bc019abcd17637dc1))


### ⚡ Performance

* cache JWKS instance in AuthService to avoid per-login key fetch ([1b9e9ec](https://github.com/QNSC-VN/opshub/commit/1b9e9ec977440ce41dceab34000e4f7b9dbba540))


### ♻️ Refactors

* adopt shared alb, dns-record, oneshot-task modules; export cloudflare facts from bootstrap ([6edad28](https://github.com/QNSC-VN/opshub/commit/6edad28224cbc2a7cba8940893db2cb717da460c))
* eliminate DRY violations — shared-kernel primitives, DTO pagination, pgEnums ([050a209](https://github.com/QNSC-VN/opshub/commit/050a209421fc022140515267272570f0edd1bd71))
* **platform:** move denylist check from JwtStrategy to JwtAuthGuard ([1a3f33c](https://github.com/QNSC-VN/opshub/commit/1a3f33cddde2305eb2732f177a76251bb04b2621))
* remove devLogin and narrow AuthMethod to sso-only ([c62da18](https://github.com/QNSC-VN/opshub/commit/c62da1840c5bb6f1f07acbd801d8160f48e324c6))
* use shared qnsc-ci release-commenter reusable ([#54](https://github.com/QNSC-VN/opshub/issues/54)) ([204e1d3](https://github.com/QNSC-VN/opshub/commit/204e1d3a065434a5f189458ed868822c683fbf9f))


### 🔒 Security

* enterprise audit — RBAC guards, CSRF, FK constraints, type fixes ([5f796a6](https://github.com/QNSC-VN/opshub/commit/5f796a6e63fd8f0675e83e862e9717906280dbfe))


### 📦 Dependencies

* bump the development-dependencies group across 1 directory with 17 updates ([#18](https://github.com/QNSC-VN/opshub/issues/18)) ([146263a](https://github.com/QNSC-VN/opshub/commit/146263a40f68e2376d768068ce4624ff7c519693))
* bump the production-dependencies group across 1 directory with 20 updates ([#9](https://github.com/QNSC-VN/opshub/issues/9)) ([400b474](https://github.com/QNSC-VN/opshub/commit/400b474ec5613d993826ff6b166fc1d12d836987))
