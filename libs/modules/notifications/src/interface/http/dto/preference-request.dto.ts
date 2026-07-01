import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const UpsertPreferenceSchema = z
  .object({
    inApp:  z.boolean().optional(),
    email:  z.boolean().optional(),
  })
  .refine((d) => d.inApp !== undefined || d.email !== undefined, {
    message: 'At least one of inApp or email must be provided',
  });

export class UpsertPreferenceDto extends createZodDto(UpsertPreferenceSchema) {}
