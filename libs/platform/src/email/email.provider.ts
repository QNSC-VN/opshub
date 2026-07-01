export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');

export type EmailCategory = 'transactional' | 'notification' | 'marketing';

export interface EmailPayload {
  to: string;
  from?: string;
  replyTo?: string;
  subject: string;
  html: string;
  text?: string;
  category?: EmailCategory;
  idempotencyKey?: string;
}

export interface IEmailProvider {
  send(payload: EmailPayload): Promise<void>;
}
