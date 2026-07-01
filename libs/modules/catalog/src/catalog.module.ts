import { Module } from '@nestjs/common';
import { AuditModule } from '@modules/audit';
import { CatalogService } from './application/catalog.service';
import { CatalogRequestTypeDef } from './application/catalog-request.type-def';
import { CatalogController } from './interface/http/catalog.controller';
import { CatalogDrizzleRepository } from './infrastructure/persistence/catalog.drizzle-repository';
import { CATALOG_REPOSITORY } from './domain/ports/catalog.repository';

@Module({
  imports: [AuditModule],
  controllers: [CatalogController],
  providers: [
    CatalogService,
    CatalogRequestTypeDef,
    { provide: CATALOG_REPOSITORY, useClass: CatalogDrizzleRepository },
  ],
  exports: [CatalogService],
})
export class CatalogModule {}
