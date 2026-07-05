import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PAGE_SIZE } from '@shared-kernel';

export class NotificationResponseDto {
  @ApiProperty() id!:            string;
  @ApiProperty() recipientId!:   string;
  @ApiPropertyOptional({ nullable: true }) actorId!: string | null;
  @ApiProperty() type!:          string;
  @ApiProperty() title!:         string;
  @ApiPropertyOptional({ nullable: true }) body!:    string | null;
  @ApiPropertyOptional({ nullable: true }) resourceType!: string | null;
  @ApiPropertyOptional({ nullable: true }) resourceId!:   string | null;
  @ApiProperty({ type: 'object', additionalProperties: true }) metadata!: Record<string, unknown>;
  @ApiProperty() isRead!:        boolean;
  @ApiPropertyOptional({ nullable: true }) readAt!: string | null;
  @ApiProperty() createdAt!:     string;
  @ApiPropertyOptional({ nullable: true }) sourceEventId!: string | null;
}

export class NotificationListResultDto {
  @ApiProperty({ type: [NotificationResponseDto] }) items!: NotificationResponseDto[];
  @ApiPropertyOptional({ nullable: true }) nextCursor!: string | null;
}

export const ListNotificationsQuerySchema = z.object({
  isRead: z.preprocess(
    (v) => (v === 'true' ? true : v === 'false' ? false : undefined),
    z.boolean().optional(),
  ),
  limit:  z.coerce.number().int().min(1).max(100).default(PAGE_SIZE.NOTIFICATION_DEFAULT),
  cursor: z.string().optional(),
});

export class ListNotificationsQueryDto extends createZodDto(ListNotificationsQuerySchema) {}
