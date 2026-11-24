import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  type AdminMenuView,
  createCategorySchema,
  createProductSchema,
  replaceOptionGroupsSchema,
  updateCategorySchema,
  updateProductSchema,
  updateStoreSchema,
} from '@onefood/shared';
import { parseBody } from '../../platform/http/validation.js';
import { CurrentStore, RequireRole, SessionGuard, type StoreAuth } from '../identity/index.js';
import { CatalogAdminService } from './catalog-admin.service.js';

/** Gestão do cardápio no painel. Ver é de qualquer membro; alterar é de dono e gerente. */
@Controller('v1/panel/stores/:slug')
@UseGuards(SessionGuard)
export class CatalogAdminController {
  constructor(@Inject(CatalogAdminService) private readonly admin: CatalogAdminService) {}

  @Get('menu')
  menu(@CurrentStore() store: StoreAuth): Promise<AdminMenuView> {
    return this.admin.getMenu(store.tenantId, store.slug);
  }

  @Patch()
  @HttpCode(204)
  @RequireRole('owner', 'manager')
  async updateStore(@CurrentStore() store: StoreAuth, @Body() body: unknown): Promise<void> {
    await this.admin.updateStore(store.tenantId, parseBody(updateStoreSchema, body));
  }

  @Post('categories')
  @RequireRole('owner', 'manager')
  createCategory(@CurrentStore() store: StoreAuth, @Body() body: unknown): Promise<{ id: string }> {
    return this.admin.createCategory(store.tenantId, parseBody(createCategorySchema, body));
  }

  @Patch('categories/:categoryId')
  @HttpCode(204)
  @RequireRole('owner', 'manager')
  async updateCategory(
    @CurrentStore() store: StoreAuth,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Body() body: unknown,
  ): Promise<void> {
    await this.admin.updateCategory(store.tenantId, categoryId, parseBody(updateCategorySchema, body));
  }

  @Post('products')
  @RequireRole('owner', 'manager')
  createProduct(@CurrentStore() store: StoreAuth, @Body() body: unknown): Promise<{ id: string }> {
    return this.admin.createProduct(store.tenantId, parseBody(createProductSchema, body));
  }

  @Patch('products/:productId')
  @HttpCode(204)
  @RequireRole('owner', 'manager')
  async updateProduct(
    @CurrentStore() store: StoreAuth,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() body: unknown,
  ): Promise<void> {
    await this.admin.updateProduct(store.tenantId, productId, parseBody(updateProductSchema, body));
  }

  @Put('products/:productId/option-groups')
  @HttpCode(204)
  @RequireRole('owner', 'manager')
  async replaceOptionGroups(
    @CurrentStore() store: StoreAuth,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() body: unknown,
  ): Promise<void> {
    await this.admin.replaceOptionGroups(store.tenantId, productId, parseBody(replaceOptionGroupsSchema, body));
  }
}
