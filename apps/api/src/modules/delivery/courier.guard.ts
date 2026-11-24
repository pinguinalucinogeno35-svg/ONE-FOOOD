import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { type CourierIdentity, CouriersService } from './couriers.service.js';

type CourierRequest = FastifyRequest & { courier?: CourierIdentity };

export const CurrentCourier = createParamDecorator((_data: unknown, context: ExecutionContext): CourierIdentity => {
  const courier = context.switchToHttp().getRequest<CourierRequest>().courier;
  if (!courier) throw new UnauthorizedException({ error: 'courier_link_invalid' });
  return courier;
});

/**
 * Autentica o entregador pelo token do link pessoal (Authorization: Bearer). O tenant e o
 * entregador vêm do token conferido no banco, nunca de um valor enviado pelo aparelho.
 */
@Injectable()
export class CourierGuard implements CanActivate {
  constructor(@Inject(CouriersService) private readonly couriers: CouriersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<CourierRequest>();
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
    // Tamanho fixo de um token gerado aqui; qualquer outra coisa nem vai ao banco.
    const courier = /^[A-Za-z0-9_-]{43}$/.test(token) ? await this.couriers.resolveToken(token) : null;
    if (!courier) throw new UnauthorizedException({ error: 'courier_link_invalid' });
    request.courier = courier;
    return true;
  }
}
