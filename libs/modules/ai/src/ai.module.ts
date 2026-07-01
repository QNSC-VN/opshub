import { Module } from '@nestjs/common';
import { AiService } from './application/ai.service';
import { AiController } from './interface/http/ai.controller';

@Module({
  providers: [AiService],
  controllers: [AiController],
  exports: [AiService],
})
export class AiModule {}
