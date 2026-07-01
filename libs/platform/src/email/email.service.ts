import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { EMAIL_PROVIDER, type IEmailProvider } from './email.provider';
import {
  renderEmailTemplate,
  type EmailTemplateName,
  type EmailTemplateVars,
} from './templates';

/**
 * EmailService — render a typed template then dispatch via the injected provider.
 *
 * Usage inside a DB transaction: use EmailSchedulerService.schedule() instead.
 * Use this service directly only when the send must be immediate (e.g. test emails).
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly from: string;

  constructor(
    @Inject(EMAIL_PROVIDER) private readonly provider: IEmailProvider,
    config: AppConfigService,
  ) {
    const name  = config.get('MAIL_FROM_NAME');
    const email = config.get('MAIL_FROM_EMAIL');
    this.from = `${name} <${email}>`;
  }

  async sendTemplate<K extends EmailTemplateName>(
    to:       string,
    template: K,
    vars:     EmailTemplateVars[K],
    opts?: { replyTo?: string; idempotencyKey?: string },
  ): Promise<void> {
    const rendered = renderEmailTemplate(template, vars);
    try {
      await this.provider.send({
        to,
        from:           this.from,
        replyTo:        opts?.replyTo,
        subject:        rendered.subject,
        html:           rendered.html,
        text:           rendered.text,
        category:       'transactional',
        idempotencyKey: opts?.idempotencyKey,
      });
    } catch (err) {
      // Log and re-throw — the relay will catch this and update the outbox row.
      this.logger.error({ err, to, template }, 'Failed to send email');
      throw err;
    }
  }
}
