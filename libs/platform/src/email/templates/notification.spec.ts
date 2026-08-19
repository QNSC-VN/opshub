/**
 * The generic notification email — the one template the cascade uses.
 *
 * `notification-email-cascade.e2e.spec.ts` proves the chain runs and the provider is reached; a row
 * arriving at `status='sent'` means `EmailService.sendTemplate` completed, and that method has no
 * branch that skips `provider.send`. What it cannot show is WHAT was rendered: a template producing an
 * empty subject, or dropping the body, reaches `sent` just as happily. That is what this file pins,
 * deterministically and without a database.
 *
 * ESCAPING IS THE OTHER HALF. Every template here interpolates caller-supplied text into markup, and
 * for this one the text is a notification title and body — which carry names, references and reasons
 * somebody typed. The sibling repo has the same shape with no escaping at all, and work-item titles
 * flow through it.
 */
import { describe, expect, it } from 'vitest';
import { renderEmailTemplate } from './index';

const APP_URL = 'https://opshub.example';

describe('the notification email template', () => {
  it('uses the notification title as the subject', () => {
    const rendered = renderEmailTemplate('notification', {
      title: 'New leave request awaiting review',
      body: 'Priya Raman requested 2 days.',
      appUrl: APP_URL,
    });

    // The bell and the inbox say the same thing — that is the whole point of one generic template
    // rather than fifteen bespoke ones.
    expect(rendered.subject).toBe('New leave request awaiting review');
    expect(rendered.html).toContain('Priya Raman requested 2 days.');
  });

  it('always produces a non-empty plain-text part alongside the HTML', () => {
    const rendered = renderEmailTemplate('notification', {
      title: 'Access request approved',
      body: null,
      appUrl: APP_URL,
    });

    // A text part is not optional politeness: a client that renders text-only shows an empty message
    // without it, and spam scoring penalises HTML-only mail.
    expect(rendered.text.trim().length).toBeGreaterThan(0);
    expect(rendered.text).toContain('Access request approved');
    expect(rendered.text).toContain(`${APP_URL}/notifications`);
  });

  it('writes the text part from the values, never by stripping tags out of the HTML', () => {
    const rendered = renderEmailTemplate('notification', {
      title: 'Risk <script>alert(1)</script> raised',
      body: 'Owner: "Ops" & <b>Security</b>',
      appUrl: APP_URL,
    });

    /*
     * `layout` used to derive the text part with `body.replace(/<[^>]+>/g, '')`. CodeQL flags that as
     * incomplete multi-character sanitization and is right to — one pass over a nested construct can
     * leave `<script` behind — and it also produced bad output, because by then the values had already
     * been HTML-escaped, so the text read `&lt;script&gt;`.
     *
     * Templates now write their own text from the same values. So the text carries the ORIGINAL
     * characters, un-escaped and un-stripped, which is what a text/plain part should contain, and no
     * HTML tag or entity appears in it at all.
     */
    expect(rendered.text).toContain('Owner: "Ops" & <b>Security</b>');
    expect(rendered.text).not.toContain('&lt;');
    expect(rendered.text).not.toContain('&amp;');
    // And no markup from the shell leaked in.
    expect(rendered.text).not.toContain('<p>');
    expect(rendered.text).not.toContain('<!DOCTYPE');
  });

  it('falls back to the title when there is no body', () => {
    const rendered = renderEmailTemplate('notification', {
      title: 'Contract expiring soon',
      body: null,
      appUrl: APP_URL,
    });

    // `body` is nullable on the notification, and an email whose only content is a subject line reads
    // as broken. Repeating the title is plain, and plain beats blank.
    expect(rendered.html).toContain('Contract expiring soon');
    expect(rendered.html).not.toContain('null');
  });

  it('links back to the app', () => {
    const rendered = renderEmailTemplate('notification', {
      title: 'Anything',
      body: null,
      appUrl: APP_URL,
    });

    // The notifications list, not the resource: a notification row carries `resourceId` but no
    // `resourceType`, so there is nothing to build a deep link from without a type-to-route table that
    // would rot. A working link to the list beats a guessed one to a route.
    expect(rendered.html).toContain(`${APP_URL}/notifications`);
  });

  it('escapes markup in the title and body rather than emitting it', () => {
    const rendered = renderEmailTemplate('notification', {
      title: 'Risk <script>alert(1)</script> raised',
      body: 'Owner: "Ops" & <b>Security</b>',
      appUrl: APP_URL,
    });

    /*
     * The values are not ours. A `<` in a notification title breaks the layout at best and injects
     * markup at worst, and titles are built from names and free text people enter.
     */
    expect(rendered.html).not.toContain('<script>');
    expect(rendered.html).toContain('&lt;script&gt;');
    expect(rendered.html).toContain('&amp;');
    expect(rendered.html).toContain('&quot;Ops&quot;');
    expect(rendered.html).not.toContain('<b>Security</b>');
  });

  it('escapes the app URL too, so a configured value cannot break out of the href', () => {
    // `APP_URL` comes from configuration rather than a user, which is exactly the argument that gets
    // made for skipping the escape — and then the value reaches an attribute unquoted.
    const rendered = renderEmailTemplate('notification', {
      title: 'Anything',
      body: null,
      appUrl: 'https://x.test/"><script>alert(1)</script>',
    });

    expect(rendered.html).not.toContain('"><script>');
  });

  it('refuses a template name it does not have', () => {
    // The relay reads the name out of a database column, so an unknown value is reachable — and must
    // fail loudly rather than send a blank email.
    expect(() => renderEmailTemplate('does-not-exist' as never, {} as never)).toThrow();
  });
});
