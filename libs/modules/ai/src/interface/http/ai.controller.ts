import { Controller, Post, Body } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth, RateLimit, ApiCommonErrors, CurrentUser, AuthorizedInService } from '@platform';
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
  /**
   * AUTHORIZATION IS PER TOOL, so the route cannot declare it.
   *
   * This said `@SelfScoped("the caller's own conversation; no other user's data is reachable")`, and
   * that sentence was false. The conversation is the caller's; the DATA the tools reach was not.
   * `search_employees` read every employee, `get_compliance_findings` every open finding, and
   * `get_active_access_grants` answered for any employee id — so the assistant would enumerate staff,
   * standing privileged access and open security findings for any authenticated caller.
   *
   * A route-level permission cannot express the real rule either: which permission is needed depends
   * on which tool the model chooses, and the two request tools need none because `RequestEngine.list`
   * narrows by actor. The check therefore belongs where the choice is made — `TOOL_PERMISSION` in
   * `AiService` — and this decorator is the honest declaration of that, pinned by a test that drives
   * the tools directly rather than through a paid API call.
   */
  @AuthorizedInService(
    'each tool requires the permission its REST twin requires; see TOOL_PERMISSION in AiService',
    'ai-tool-authorization.e2e.spec.ts',
  )
  @ApiOperation({ summary: 'Send a message to the AI assistant' })
  @ApiCommonErrors()
  async chat(@Body() dto: ChatRequestDto, @CurrentUser() user: JwtPayload) {
    return this.ai.chat({
      messages: dto.messages,
      actorId: user.sub,
      actorRole: user.email,
    });
  }
}
