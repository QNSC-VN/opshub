import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

const ChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(4000),
});

export const ChatRequestSchema = z.object({
  messages: z.array(ChatMessageSchema).min(1).max(50),
});

export class ChatRequestDto extends createZodDto(ChatRequestSchema) {}
