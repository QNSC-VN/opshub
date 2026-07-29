// Adoption of the Cloudflare Pages project that already exists.
//
// `opshub-develop-web` was created out of band and serves traffic —
// `opshub-develop-web.pages.dev` answers 200 — but it has never been in this state
// file, because the account id was read from `secrets.CLOUDFLARE_ACCOUNT_ID` and that
// is an org-level VARIABLE. A `secrets.` reference to a variable is empty with no
// error, so the count-gated `module.web` resolved to 0 on every apply.
//
// Now that the id is set, a plain apply would try to CREATE a project that is already
// there and fail with "a project with this name already exists". This block makes
// Terraform adopt it instead. Import blocks are resolved during PLAN, so a wrong id or
// a missing object fails the PR rather than the apply.
//
// Only the PROJECT is imported. The custom domain and its CNAME are created, not
// adopted: `opshub-dev.qnsc.vn` has no DNS record at all, and Cloudflare creates the
// CNAME itself when a custom domain is attached to a project in a zone on the same
// account — so no record means no custom domain was ever attached.
//
// Safe to delete once develop has applied.
import {
  to = module.stack.module.web[0].cloudflare_pages_project.this
  id = "69e52835cf2d08edde5b6ebd741d30fa/opshub-develop-web"
}
