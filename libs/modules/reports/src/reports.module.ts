import { Module } from '@nestjs/common';
import { ReportsService } from './application/reports.service';
import { ReportsController } from './interface/http/reports.controller';

@Module({
  providers: [ReportsService],
  controllers: [ReportsController],
})
export class ReportsModule {}
