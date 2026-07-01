import { z } from 'zod';

/**
 * Stable error envelope returned by the API for every non-2xx response.
 * The FE branches on `code` (machine-readable), never on `message`.
 */
export const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(z.unknown()).optional(),
    correlationId: z.string(),
  }),
});

export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;
