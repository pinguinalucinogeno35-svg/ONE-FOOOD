import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/index.js';
import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';
import { CatalogAdminController } from './catalog-admin.controller.js';
import { CatalogAdminService } from './catalog-admin.service.js';

@Module({
  imports: [IdentityModule],
  controllers: [CatalogController, CatalogAdminController],
  providers: [CatalogService, CatalogAdminService],
  exports: [CatalogService],
})
export class CatalogModule {}
