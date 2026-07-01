import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const BaselineQuerySchema = z.object({
  category: z.enum(['asr', 'firewall', 'encryption', 'endpoint', 'identity', 'other']).optional(),
});

export class BaselineQueryDto extends createZodDto(BaselineQuerySchema) {}

export const ScoreHistoryQuerySchema = z.object({
  days: z.coerce.number().int().min(7).max(90).default(30),
});

export class ScoreHistoryQueryDto extends createZodDto(ScoreHistoryQuerySchema) {}
