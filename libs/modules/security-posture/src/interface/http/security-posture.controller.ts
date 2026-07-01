import { Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiCommonErrors, RequirePermission } from '@platform';
import { GraphSecureScoreService } from '../../application/graph-secure-score.service';
import { SecurityPostureSyncCron } from '../../application/security-posture-sync.cron';
import { BaselineQueryDto, ScoreHistoryQueryDto } from './dto/security-posture.dto';

@ApiTags('security-posture')
@Controller('security-posture')
export class SecurityPostureController {
  constructor(
    private readonly scoreService: GraphSecureScoreService,
    private readonly syncCron: SecurityPostureSyncCron,
  ) {}

  @Get('score')
  @RequirePermission('security.view')
  @ApiOperation({ summary: 'Get current Secure Score and delta vs previous period' })
  @ApiCommonErrors(401, 403)
  async getScore() {
    const latest = await this.scoreService.getLatestScore();
    return { latest };
  }

  @Get('score/history')
  @RequirePermission('security.view')
  @ApiOperation({ summary: 'Secure Score trend data (up to 90 days)' })
  @ApiCommonErrors(401, 403)
  async getScoreHistory(@Query() query: ScoreHistoryQueryDto) {
    const history = await this.scoreService.getScoreHistory(query.days);
    return { history, days: query.days };
  }

  @Get('baseline')
  @RequirePermission('security.view')
  @ApiOperation({ summary: 'List baseline drift checks, optionally filtered by category' })
  @ApiCommonErrors(401, 403)
  async getBaseline(@Query() query: BaselineQueryDto) {
    const [checks, summary] = await Promise.all([
      this.scoreService.getBaselineChecks(query.category),
      this.scoreService.getBaselineSummary(),
    ]);
    return { checks, summary };
  }

  @Post('sync')
  @RequirePermission('security.manage')
  @ApiOperation({ summary: 'Manually trigger a security posture sync from Graph' })
  @ApiCommonErrors(401, 403)
  async triggerSync() {
    await this.syncCron.syncSecurityPosture();
    return { ok: true };
  }
}
