import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { type IEmailProvider, type EmailPayload } from '../email.provider';

/**
 * Resend email provider — uses the official Resend SDK.
 * Injects the Resend client rather than creating it internally so it can be
 * swapped in tests without monkey-patching.
 */
@Injectable()
export class ResendEmailProvider implements IEmailProvider {
  private readonly logger = new Logger(ResendEmailProvider.name);
  private readonly client: Resend;

  constructor(apiKey: string) {
    this.client = new Resend(apiKey);
  }

  async send(payload: EmailPayload): Promise<void> {
    const { error } = await this.client.emails.send({
      from:     payload.from ?? 'OpsHub <no-reply@opshub.app>',
      to:       [payload.to],
      replyTo:  payload.replyTo,
      subject:  payload.subject,
      html:     payload.html,
      text:     payload.text,
      headers:  payload.idempotencyKey
        ? { 'X-Idempotency-Key': payload.idempotencyKey }
        : undefined,
      tags: payload.category
        ? [{ name: 'category', value: payload.category }]
        : undefined,
    });

    if (error) {
      this.logger.error({ error, to: payload.to }, 'Resend delivery failed');
      throw new Error(`Resend: ${error.message}`);
    }
  }
}
