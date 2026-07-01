import { Controller, Post, Body } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth, RateLimit, ApiCommonErrors, CurrentUser } from '@platform';
import type { JwtPayload } from '@platform';
import { AiService } from '../../application/ai.service';
import { ChatRequestDto } from './dto/ai.dto';

@ApiTags('ai')
@Controller('ai')
@Auth()
@RateLimit('AI')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Post('chat')
  @ApiOperation({ summary: 'Send a message to the AI assistant' })
  @ApiCommonErrors()
  async chat(
    @Body() dto: ChatRequestDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.ai.chat({
      messages: dto.messages,
      actorId: user.sub,
      actorRole: user.email,
    });
  }
}
