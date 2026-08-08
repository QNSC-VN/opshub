import {
  Controller,
  Get,
  Patch,
  Param,
  ParseUUIDPipe,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOkResponse, ApiNoContentResponse, ApiProperty } from '@nestjs/swagger';
import { Auth, CurrentUser, type JwtPayload, SelfScoped } from '@platform';
import { NotificationsService } from '../../application/notifications.service';
import { ListNotificationsQueryDto, NotificationListResultDto } from './dto/notification.dto';

class UnreadCountResponseDto {
  @ApiProperty({ description: 'Number of unread notifications' }) count!: number;
}

@ApiTags('notifications')
@Auth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  /** List in-app notifications for the current user (cursor-paginated). */
  @Get()
  @SelfScoped("lists only the caller's notifications — repository filters on user.sub")
  @ApiOkResponse({ type: NotificationListResultDto })
  list(@CurrentUser() user: JwtPayload, @Query() query: ListNotificationsQueryDto) {
    return this.service.list(user.sub, {
      isRead: query.isRead,
      limit: query.limit,
      cursor: query.cursor,
    });
  }

  /** Get unread notification count for the badge. */
  @Get('unread-count')
  @SelfScoped("counts only the caller's unread notifications")
  @ApiOkResponse({ type: UnreadCountResponseDto })
  unreadCount(@CurrentUser() user: JwtPayload) {
    return this.service.unreadCount(user.sub).then((count) => ({ count }));
  }

  /** Mark a single notification as read. */
  @Patch(':id/read')
  @SelfScoped('marks a notification the caller owns; the update is keyed on user.sub')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  markRead(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.markRead(id, user.sub);
  }

  /** Mark all notifications as read. */
  @Patch('read-all')
  @SelfScoped("marks only the caller's notifications")
  @HttpCode(HttpStatus.NO_CONTENT)
  markAllRead(@CurrentUser() user: JwtPayload) {
    return this.service.markAllRead(user.sub);
  }
}
