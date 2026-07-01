import { ApiProperty } from '@nestjs/swagger';
import type { NotificationPreference } from '../../../domain/notification-preference.types';

export class PreferenceResponseDto {
  @ApiProperty() type!:      string;
  @ApiProperty() inApp!:     boolean;
  @ApiProperty() email!:     boolean;
  @ApiProperty() updatedAt!: string;

  static fromDomain(pref: NotificationPreference): PreferenceResponseDto {
    const dto = new PreferenceResponseDto();
    dto.type      = pref.type;
    dto.inApp     = pref.inApp;
    dto.email     = pref.email;
    dto.updatedAt = pref.updatedAt.toISOString();
    return dto;
  }
}
