import { Controller, Get, Header, Inject, Param } from '@nestjs/common';
import type { MenuView } from '@onefood/shared';
import { TenantsService } from '../../platform/tenants/tenants.service.js';
import { CatalogService } from './catalog.service.js';

@Controller('v1/stores/:slug')
export class CatalogController {
  constructor(
    @Inject(TenantsService) private readonly tenants: TenantsService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
  ) {}

  /** Cardápio público. O cabeçalho de cache deixa a CDN servir sem tocar o banco a cada visita. */
  @Get('menu')
  @Header('Cache-Control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=300')
  async menu(@Param('slug') slug: string): Promise<MenuView> {
    const tenantId = await this.tenants.resolveSlug(slug);
    return this.catalog.getMenu(tenantId, slug);
  }
}
