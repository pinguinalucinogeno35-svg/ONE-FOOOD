import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@onefood/shared';
import type { FastifyRequest } from 'fastify';
import type { Config } from '../../config.js';
import { readCookie } from '../../platform/http/cookies.js';
import { CONFIG } from '../../platform/tokens.js';
import { type AuthContext, IdentityService, type StoreAccess } from './identity.service.js';

export const SESSION_COOKIE = 'onefood_session';
const ROLES_KEY = 'onefood:roles';

/** Acesso do usuário ao restaurante da rota (/…/stores/:slug/…). */
export interface StoreAuth extends StoreAccess {
  userId: string;
}

type AuthedRequest = FastifyRequest & { auth?: AuthContext; storeAuth?: StoreAuth };

/** Restringe a rota a certos papéis. Sem este decorador, qualquer membro do restaurante entra. */
export const RequireRole = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthContext => {
  const auth = context.switchToHttp().getRequest<AuthedRequest>().auth;
  if (!auth) throw new UnauthorizedException({ error: 'not_authenticated' });
  return auth;
});

export const CurrentStore = createParamDecorator((_data: unknown, context: ExecutionContext): StoreAuth => {
  const store = context.switchToHttp().getRequest<AuthedRequest>().storeAuth;
  if (!store) throw new NotFoundException({ error: 'store_not_found' });
  return store;
});

/**
 * Exige sessão válida. Em rotas com :slug, exige também que o usuário pertença àquele
 * restaurante: é este vínculo, vindo do banco, que decide o tenant da requisição.
 * O cliente nunca escolhe o tenant por conta própria.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(IdentityService) private readonly identity: IdentityService,
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();

    // Defesa extra contra requisição forjada por outro site, além do SameSite do cookie.
    const origin = request.headers.origin;
    const mutating = request.method !== 'GET' && request.method !== 'HEAD';
    if (mutating && origin && origin !== this.config.WEB_ORIGIN) {
      throw new ForbiddenException({ error: 'origin_not_allowed' });
    }

    const token = readCookie(request.headers.cookie, SESSION_COOKIE);
    const auth = token ? await this.identity.resolveSession(token) : null;
    if (!auth) throw new UnauthorizedException({ error: 'not_authenticated' });
    request.auth = auth;

    const slug = (request.params as { slug?: string } | undefined)?.slug;
    if (slug !== undefined) {
      const store = auth.stores.find((candidate) => candidate.slug === slug);
      // Mesmo erro de loja inexistente: quem não é membro não descobre quais lojas existem.
      if (!store) throw new NotFoundException({ error: 'store_not_found' });

      const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (roles && !roles.includes(store.role)) throw new ForbiddenException({ error: 'role_not_allowed' });
      request.storeAuth = { ...store, userId: auth.userId };
    }
    return true;
  }
}
