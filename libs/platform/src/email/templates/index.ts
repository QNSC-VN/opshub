/**
 * Email template registry for OpsHub.
 *
 * Each template produces an HTML + plain-text pair from a strongly-typed vars
 * object. Templates are intentionally simple HTML strings — no external
 * templating engine, no build step.
 */

// ── Template names ────────────────────────────────────────────────────────────

export type EmailTemplateName =
  | 'access-request.submitted'
  | 'access-request.approved'
  | 'access-request.denied'
  | 'asset.assigned'
  | 'offboarding.complete'
  /**
   * The GENERIC one, and the only template the notification cascade uses.
   *
   * There are fifteen notification types and five bespoke templates above, whose names do not even
   * correspond — `employee.offboarded` versus `offboarding.complete`, snake_case versus kebab-case. A
   * per-type mapping would cover a third of them, silently omit the rest, and rot every time a
   * notification type is added.
   *
   * `renderNotification` already produces the title and body shown in-app, so the email says the same
   * thing as the bell. One template, every type, and a new type needs no work here.
   */
  | 'notification';

// ── Per-template variable shapes ─────────────────────────────────────────────

export interface EmailTemplateVars {
  'access-request.submitted': {
    requesterName: string;
    resourceName: string;
    reason?: string;
    appUrl: string;
  };
  'access-request.approved': {
    requesterName: string;
    resourceName: string;
    approverName: string;
    appUrl: string;
  };
  'access-request.denied': {
    requesterName: string;
    resourceName: string;
    approverName: string;
    reason?: string;
    appUrl: string;
  };
  'asset.assigned': {
    employeeName: string;
    assetName: string;
    assetTag: string;
    appUrl: string;
  };
  /** What `renderNotification` already produced, plus where the app lives. */
  notification: {
    title: string;
    body: string | null;
    appUrl: string;
  };
  'offboarding.complete': {
    employeeName: string;
    managerName: string;
    completedAt: string; // ISO date string
    appUrl: string;
  };
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * HTML-escape a value before it goes into a template.
 *
 * Every template below interpolates caller-supplied text straight into markup, and the values are not
 * ours: an asset name, a rejection reason, a notification title carrying a work-item name somebody
 * typed. Unescaped, a `<` in any of them breaks the layout at best and injects markup into an email at
 * worst. The sibling repo has the same shape and no escaping, which is what made this worth adding here
 * rather than only on the new template.
 *
 * Applied at the interpolation site rather than inside `layout`, because `layout` receives markup the
 * templates built on purpose — escaping there would escape the tags too.
 */
function esc(value: string | number): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Wrap a built body in the shared shell.
 *
 * `subject` IS ESCAPED FOR THE `<title>` ELEMENT and left raw in the returned `subject` field: a mail
 * header is not HTML, but the copy inside the document is. A subject carrying a notification's title —
 * which is where names and free text arrive — otherwise injects straight into the markup. The `body`
 * argument is NOT escaped here, because callers pass markup they built on purpose; they escape their
 * own values with `esc` at each interpolation.
 */
function layout(subject: string, body: string): RenderedEmail {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(subject)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           background: #f6f7fb; margin: 0; padding: 32px 0; }
    .card { max-width: 520px; margin: 0 auto; background: #fff;
            border-radius: 8px; padding: 40px; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
    h2 { margin: 0 0 16px; font-size: 20px; color: #111; }
    p  { margin: 0 0 12px; font-size: 15px; line-height: 1.5; color: #444; }
    .label { font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: .5px; }
    .value { font-weight: 600; color: #111; }
    .btn { display: inline-block; margin-top: 24px; padding: 12px 24px;
           background: #6366f1; color: #fff !important; border-radius: 6px;
           text-decoration: none; font-size: 14px; font-weight: 600; }
    .footer { margin-top: 32px; font-size: 12px; color: #aaa; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <h2>OpsHub</h2>
    ${body}
    <div class="footer">This is an automated message from OpsHub. Do not reply.</div>
  </div>
</body>
</html>`;
  const text =
    subject +
    '\n\n' +
    body
      .replace(/<[^>]+>/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  return { subject, html, text };
}

// ── Template implementations ──────────────────────────────────────────────────

const templates: {
  [K in EmailTemplateName]: (v: EmailTemplateVars[K]) => RenderedEmail;
} = {
  'access-request.submitted'(v) {
    return layout(
      'Your access request has been submitted',
      `<p>Hi <span class="value">${esc(v.requesterName)}</span>,</p>
       <p>Your request for access to <span class="value">${esc(v.resourceName)}</span> has been received
          and is pending approval.</p>
       ${v.reason ? `<p><span class="label">Reason:</span> ${esc(v.reason)}</p>` : ''}
       <a class="btn" href="${esc(v.appUrl)}">View Request</a>`,
    );
  },

  'access-request.approved'(v) {
    return layout(
      'Access request approved',
      `<p>Hi <span class="value">${esc(v.requesterName)}</span>,</p>
       <p>Your request for access to <span class="value">${esc(v.resourceName)}</span> has been
          <span class="value" style="color:#16a34a">approved</span> by
          <span class="value">${esc(v.approverName)}</span>.</p>
       <a class="btn" href="${esc(v.appUrl)}">Open OpsHub</a>`,
    );
  },

  'access-request.denied'(v) {
    return layout(
      'Access request denied',
      `<p>Hi <span class="value">${esc(v.requesterName)}</span>,</p>
       <p>Your request for access to <span class="value">${esc(v.resourceName)}</span> has been
          <span class="value" style="color:#dc2626">denied</span> by
          <span class="value">${esc(v.approverName)}</span>.</p>
       ${v.reason ? `<p><span class="label">Reason:</span> ${esc(v.reason)}</p>` : ''}
       <a class="btn" href="${esc(v.appUrl)}">View Request</a>`,
    );
  },

  'asset.assigned'(v) {
    return layout(
      `Asset assigned: ${esc(v.assetName)}`,
      `<p>Hi <span class="value">${esc(v.employeeName)}</span>,</p>
       <p>An asset has been assigned to you in OpsHub.</p>
       <p><span class="label">Asset:</span> <span class="value">${esc(v.assetName)}</span></p>
       <p><span class="label">Tag:</span> <span class="value">${esc(v.assetTag)}</span></p>
       <a class="btn" href="${esc(v.appUrl)}">View Asset</a>`,
    );
  },

  notification(v) {
    /*
     * LINKS TO THE NOTIFICATIONS VIEW, not to the resource.
     *
     * A notification row carries `resourceId` but no `resourceType`, so there is nothing to build a
     * deep link from without a type-to-route table that would rot. The sibling repo has the same
     * limitation and the same landing page. Better a working link to the list than a broken one to a
     * guessed route.
     */
    return layout(
      v.title,
      `<p>${esc(v.body ?? v.title)}</p>
       <a class="btn" href="${esc(v.appUrl)}/notifications">Open OpsHub</a>`,
    );
  },

  'offboarding.complete'(v) {
    return layout(
      `Offboarding complete: ${esc(v.employeeName)}`,
      `<p>Hi <span class="value">${esc(v.managerName)}</span>,</p>
       <p>The offboarding checklist for <span class="value">${esc(v.employeeName)}</span> has been
          completed on <span class="value">${esc(v.completedAt)}</span>.</p>
       <a class="btn" href="${esc(v.appUrl)}">View Details</a>`,
    );
  },
};

// ── Public API ────────────────────────────────────────────────────────────────

export function renderEmailTemplate<K extends EmailTemplateName>(
  name: K,
  vars: EmailTemplateVars[K],
): RenderedEmail {
  const fn = templates[name];
  return (fn as (v: EmailTemplateVars[K]) => RenderedEmail)(vars);
}
