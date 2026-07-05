import { z } from 'zod';
import { PAGE_SIZE } from '../constants';

export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(PAGE_SIZE.MAX).default(PAGE_SIZE.DEFAULT),
  offset: z.coerce.number().int().min(0).default(0),
});

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;
