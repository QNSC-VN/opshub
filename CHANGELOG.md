# Changelog

## [0.3.0](https://github.com/QNSC-VN/opshub/compare/v0.2.1...v0.3.0) (2026-08-08)


### ⚠ BREAKING CHANGES

* **http:** validate every uuid path parameter, and ratchet it ([#125](https://github.com/QNSC-VN/opshub/issues/125))
* **platform:** remove the unconsumed domain-event outbox leg ([#123](https://github.com/QNSC-VN/opshub/issues/123))

### ✨ Features

* **dev:** add LocalStack to the dev stack so SQS and uploads run locally ([#120](https://github.com/QNSC-VN/opshub/issues/120)) ([ac9c80e](https://github.com/QNSC-VN/opshub/commit/ac9c80e74dfac5dc501c9a89f1d561c548d3d4f1))
* **infra:** wake develop on a weekday morning, and make the guards actually fail ([#116](https://github.com/QNSC-VN/opshub/issues/116)) ([638a360](https://github.com/QNSC-VN/opshub/commit/638a360e883c0e6e9a92ea2afd2d2c50729ec2d8))
* **infra:** watch tunnelled ingress from outside aws, gated on the idle posture ([#117](https://github.com/QNSC-VN/opshub/issues/117)) ([7612c98](https://github.com/QNSC-VN/opshub/commit/7612c981cc10f7b014bb111d42a36abc399b1aef))
* **observability:** adopt rally's telemetry and alarms, with the sampler actually applied ([#110](https://github.com/QNSC-VN/opshub/issues/110)) ([e0f475b](https://github.com/QNSC-VN/opshub/commit/e0f475b2596608a6c64ad3692243ba0a70e25763))
* **observability:** alarm when a security control fails open ([#112](https://github.com/QNSC-VN/opshub/issues/112)) ([ecac793](https://github.com/QNSC-VN/opshub/commit/ecac793207ce758cdb4537894434c9e3540c3c95))
* **observability:** local OTLP collector, and make OTEL_ENABLED actually work ([#127](https://github.com/QNSC-VN/opshub/issues/127)) ([8ad9f14](https://github.com/QNSC-VN/opshub/commit/8ad9f149bd89173f64e27ae424a939c45f5d19aa))
* **platform:** port rally's relay backoff, metrics and seed floor ([#122](https://github.com/QNSC-VN/opshub/issues/122)) ([29185cc](https://github.com/QNSC-VN/opshub/commit/29185cc10a654373ef8373a996f041b8b7f9c0bc))
* **scheduling:** run every scheduled job on exactly one pod ([#129](https://github.com/QNSC-VN/opshub/issues/129)) ([52f5ac8](https://github.com/QNSC-VN/opshub/commit/52f5ac802f67c63b1bfaa5e8b6d807bf9ef859e2))


### 🐛 Bug Fixes

* **access-requests:** stop 500ing on approval, and stop losing notifications ([#124](https://github.com/QNSC-VN/opshub/issues/124)) ([8a3aa18](https://github.com/QNSC-VN/opshub/commit/8a3aa181ac409e9e82855005ecb22753026b6a43))
* **audit:** stop recording every action twice, and make the entry atomic with the change ([#130](https://github.com/QNSC-VN/opshub/issues/130)) ([e761571](https://github.com/QNSC-VN/opshub/commit/e761571f1fc7647ac5bd4c83b387ac2f79de26f8))
* **authz:** the boot audit's route floor is ZERO, not the full route count ([#134](https://github.com/QNSC-VN/opshub/issues/134)) ([d27ab9c](https://github.com/QNSC-VN/opshub/commit/d27ab9c40d97ae7eb6b6436c1c8f48a982b61456))
* **db:** make every ORDER BY a total order, and ratchet it at zero ([#108](https://github.com/QNSC-VN/opshub/issues/108)) ([2cec3b3](https://github.com/QNSC-VN/opshub/commit/2cec3b30ccf9a8127ac2d3f29720d482defe28b1))
* **deps:** pin nanoid &gt;= 3.3.17 for GHSA-2v37-7h3g-55p8 ([#131](https://github.com/QNSC-VN/opshub/issues/131)) ([9ea4e3e](https://github.com/QNSC-VN/opshub/commit/9ea4e3e01f098e0f1b5b2815fe8cfd82ac1d69e7))
* **deps:** raise the js-yaml floor to 4.3.1 for CVE-2026-59870 ([#126](https://github.com/QNSC-VN/opshub/issues/126)) ([df79df5](https://github.com/QNSC-VN/opshub/commit/df79df528116eab7ea471d6966d7659410ff66b1))
* **http:** validate every uuid path parameter, and ratchet it ([#125](https://github.com/QNSC-VN/opshub/issues/125)) ([07961ff](https://github.com/QNSC-VN/opshub/commit/07961ff0c16913fc215a419e4002fe28b998ecbe))
* **infra:** make the db-pool guard fail instead of warn ([#118](https://github.com/QNSC-VN/opshub/issues/118)) ([525e52b](https://github.com/QNSC-VN/opshub/commit/525e52bced1717bfd312d499ae5cee619f6ef42e))
* **infra:** refuse autoscaling with a floor of zero ([#119](https://github.com/QNSC-VN/opshub/issues/119)) ([01c80f2](https://github.com/QNSC-VN/opshub/commit/01c80f232c9bb00d20c8385c816ddceac12fc603))
* **worker:** put the outbox relay on the shared base and alarm on dead letters ([#121](https://github.com/QNSC-VN/opshub/issues/121)) ([461f720](https://github.com/QNSC-VN/opshub/commit/461f720ab9390d39f60f3fc6ffeb28188d6b43dd))


### ♻️ Refactors

* **observability:** take the OTel bootstrap and Span from the shared package ([#114](https://github.com/QNSC-VN/opshub/issues/114)) ([871fee2](https://github.com/QNSC-VN/opshub/commit/871fee2110ad7ccd71eb2c0eea11730409db985d))
* **platform:** remove the unconsumed domain-event outbox leg ([#123](https://github.com/QNSC-VN/opshub/issues/123)) ([92c3f4c](https://github.com/QNSC-VN/opshub/commit/92c3f4c4aa0d8506f460c6e3037c9ddc3527180d))


### 🔒 Security

* **authz:** deny routes that declare no authorization, and refuse to boot on one ([#132](https://github.com/QNSC-VN/opshub/issues/132)) ([70427eb](https://github.com/QNSC-VN/opshub/commit/70427eb3b2bebd122206b28b15fb1c67ddb5e4e9))
* **authz:** narrow request and access-request reads to the caller ([#133](https://github.com/QNSC-VN/opshub/issues/133)) ([ddf242f](https://github.com/QNSC-VN/opshub/commit/ddf242f2ea042cb9d9bb9c6c9ee3aaeb17c262af))

## [0.2.1](https://github.com/QNSC-VN/opshub/compare/v0.2.0...v0.2.1) (2026-08-05)


### ✨ Features

* **db:** least-privilege postgres roles, created but not yet cut over ([#106](https://github.com/QNSC-VN/opshub/issues/106)) ([f010fb3](https://github.com/QNSC-VN/opshub/commit/f010fb3d2260036de62a24758dcc9da16e941705))


### 🐛 Bug Fixes

* **workforce:** scope HR record reads and self-service transitions to the caller ([#105](https://github.com/QNSC-VN/opshub/issues/105)) ([fceac07](https://github.com/QNSC-VN/opshub/commit/fceac07ae619845eddc9c575eb74cade27017ab1))

## [0.2.0](https://github.com/QNSC-VN/opshub/compare/v0.1.1...v0.2.0) (2026-08-05)


### ⚠ BREAKING CHANGES

* **infra:** tunnel ingress, idling, and floors that let an environment park ([#97](https://github.com/QNSC-VN/opshub/issues/97))
* **web:** sign in through the BFF, and hold no token in the browser ([#88](https://github.com/QNSC-VN/opshub/issues/88))
* **db,infra:** compose the DB URL from parts, derive the JWT public key ([#82](https://github.com/QNSC-VN/opshub/issues/82))
* **infra:** one stack module for both environments, and a shared cache node ([#81](https://github.com/QNSC-VN/opshub/issues/81))
* **authz:** `RoleGuard`, `RequireRoles` and `ROLES_KEY` are removed, and `Auth()` no longer accepts role arguments. `PERMISSION`/`PermissionKey` are no longer exported from `constants.ts` — import them from `@shared-kernel`, which now re-exports the catalogue. No route changes behaviour: every enforced code was already from the seeded vocabulary.

### ✨ Features

* adopt [@qnsc-vn](https://github.com/qnsc-vn) shared cache and identity primitives (rebased [#37](https://github.com/QNSC-VN/opshub/issues/37)) ([#62](https://github.com/QNSC-VN/opshub/issues/62)) ([a3846e8](https://github.com/QNSC-VN/opshub/commit/a3846e83c1012b08e0cc6cf94a98615aa3bd3757))
* **auth:** put browser sessions behind an opaque BFF cookie ([#85](https://github.com/QNSC-VN/opshub/issues/85)) ([aa09d4f](https://github.com/QNSC-VN/opshub/commit/aa09d4f890a2bb220e9a8fce51cd1bcf6de439cb))
* **authz:** one typed permission catalogue, and retire the RoleGuard ([#76](https://github.com/QNSC-VN/opshub/issues/76)) ([a6dd65a](https://github.com/QNSC-VN/opshub/commit/a6dd65a3fced9662eb2e71004db090b5b2e9ff2c))
* **db,infra:** compose the DB URL from parts, derive the JWT public key ([#82](https://github.com/QNSC-VN/opshub/issues/82)) ([a7c55b5](https://github.com/QNSC-VN/opshub/commit/a7c55b574fa2306c999ec7f98539320dee71f6b1))
* **infra:** bootstrap opshub's AWS foundations and align the shared module pins ([#79](https://github.com/QNSC-VN/opshub/issues/79)) ([72ae822](https://github.com/QNSC-VN/opshub/commit/72ae8222b1f5241804ac9f5334f5f073043e92c2))
* **infra:** give opshub prod its own dedicated cache node ([#66](https://github.com/QNSC-VN/opshub/issues/66)) ([86fb985](https://github.com/QNSC-VN/opshub/commit/86fb985f57afeb45c8933bb116b87cfbec0e7e28))
* **infra:** tunnel ingress, idling, and floors that let an environment park ([#97](https://github.com/QNSC-VN/opshub/issues/97)) ([1995ccb](https://github.com/QNSC-VN/opshub/commit/1995ccbda670e7443110308dfc74550188f193c6))
* **platform:** make StorageService endpoint-aware for R2 (config-driven) ([#52](https://github.com/QNSC-VN/opshub/issues/52)) ([fa7f687](https://github.com/QNSC-VN/opshub/commit/fa7f687f67ac254052ce6aa3d7c47130801e34ab))
* **web,infra:** adopt the Pages project and proxy /v1 same-origin ([#84](https://github.com/QNSC-VN/opshub/issues/84)) ([d2efb94](https://github.com/QNSC-VN/opshub/commit/d2efb94f5773537575cdf65e7a72b0b1b92cc2be))
* **web:** sign in through the BFF, and hold no token in the browser ([#88](https://github.com/QNSC-VN/opshub/issues/88)) ([2c5f1f8](https://github.com/QNSC-VN/opshub/commit/2c5f1f8747c19dfa48f3471866ba7140fcd5717f))


### 🐛 Bug Fixes

* **docker:** drop the base image's global npm from the runtime stages ([#83](https://github.com/QNSC-VN/opshub/issues/83)) ([84189f2](https://github.com/QNSC-VN/opshub/commit/84189f2e63886561f0957bcdee736c2780b5ade6))
* **platform:** bound the DB pool to the instance, and attribute request latency ([#86](https://github.com/QNSC-VN/opshub/issues/86)) ([20e7342](https://github.com/QNSC-VN/opshub/commit/20e73429ef92cd87b34dc56d61105424f22279b2))
* **web:** stop dropping Set-Cookie, and make the defence testable ([#87](https://github.com/QNSC-VN/opshub/issues/87)) ([86a5c67](https://github.com/QNSC-VN/opshub/commit/86a5c6762bf2db146d258909a44fc457b9ad963b))


### ♻️ Refactors

* **infra:** one stack module for both environments, and a shared cache node ([#81](https://github.com/QNSC-VN/opshub/issues/81)) ([a9361f6](https://github.com/QNSC-VN/opshub/commit/a9361f61e8c081c2930323e628fabd85fc05907d))


### 🔒 Security

* **authz:** enforce scoped grants instead of silently widening them ([#77](https://github.com/QNSC-VN/opshub/issues/77)) ([1dfac1e](https://github.com/QNSC-VN/opshub/commit/1dfac1e76e9a594789b211a43ebd93105661c6c3))
* **authz:** invalidate holders when a role's definition changes ([#78](https://github.com/QNSC-VN/opshub/issues/78)) ([a1e3b4b](https://github.com/QNSC-VN/opshub/commit/a1e3b4b91c1db559dad283b3e7f8fb7903537db6))
* **deps:** clear the CVEs blocking Security · Scan, and match rally's base image ([0de1cee](https://github.com/QNSC-VN/opshub/commit/0de1ceeba73d6c8727d85addc086cca2baebd9df))


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
