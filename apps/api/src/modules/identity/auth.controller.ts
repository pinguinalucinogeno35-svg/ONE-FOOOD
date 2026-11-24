import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import { loginSchema, type MeView, signupSchema } from '@onefood/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../../config.js';
import { readCookie, serializeSessionCookie } from '../../platform/http/cookies.js';
import { parseBody } from '../../platform/http/validation.js';
import { RateLimiter } from '../../platform/rate-limit/rate-limiter.js';
import { CONFIG } from '../../platform/tokens.js';
import { type AuthContext, IdentityService, toMeView } from './identity.service.js';
import { CurrentUser, SESSION_COOKIE, SessionGuard } from './session.guard.js';

@Controller('v1/auth')
export class AuthController {
  constructor(
    @Inject(IdentityService) private readonly identity: IdentityService,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  /** Cadastro self-service: cria a conta e o restaurante e já deixa o dono logado. */
  @Post('signup')
  async signup(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<MeView> {
    const input = parseBody(signupSchema, body);
    await this.limiter.enforce(`signup:${request.ip}`, this.config.SIGNUP_LIMIT_PER_IP_HOUR, 3_600);
    const token = await this.identity.signup(input);
    return this.startSession(reply, token);
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<MeView> {
    const input = parseBody(loginSchema, body);
    // Por conta e por IP: segura quem tenta adivinhar a senha de alguém.
    await this.limiter.enforce(`login:${request.ip}:${input.email}`, this.config.LOGIN_LIMIT_PER_ACCOUNT_15MIN, 900);
    const token = await this.identity.login(input);
    return this.startSession(reply, token);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<void> {
    const token = readCookie(request.headers.cookie, SESSION_COOKIE);
    if (token) await this.identity.logout(token);
    reply.header('set-cookie', this.cookie('', 0));
  }

  @Get('me')
  @UseGuards(SessionGuard)
  me(@CurrentUser() auth: AuthContext): MeView {
    return toMeView(auth);
  }

  private async startSession(reply: FastifyReply, token: string): Promise<MeView> {
    const auth = await this.identity.resolveSession(token);
    if (!auth) throw new Error('sessão recém-criada não foi encontrada');
    reply.header('set-cookie', this.cookie(token, this.identity.sessionTtlSeconds));
    return toMeView(auth);
  }

  private cookie(value: string, maxAgeSeconds: number): string {
    return serializeSessionCookie(SESSION_COOKIE, value, {
      maxAgeSeconds,
      secure: this.config.NODE_ENV === 'production',
    });
  }
}
