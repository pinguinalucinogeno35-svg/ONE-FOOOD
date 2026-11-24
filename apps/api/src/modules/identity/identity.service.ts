import { createHash, randomBytes } from 'node:crypto';
import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { LoginInput, MeView, Role, SignupInput } from '@onefood/shared';
import type { Config } from '../../config.js';
import { TenantDb } from '../../platform/db/tenant-db.js';
import { newId } from '../../platform/ids.js';
import { CONFIG } from '../../platform/tokens.js';
import { DUMMY_HASH, hashPassword, verifyPassword } from './passwords.js';

export interface StoreAccess {
  tenantId: string;
  slug: string;
  name: string;
  role: Role;
}

export interface AuthContext {
  userId: string;
  email: string;
  name: string;
  stores: StoreAccess[];
}

interface SessionRow {
  user_id: string;
  email: string;
  name: string;
  tenant_id: string | null;
  tenant_slug: string | null;
  tenant_name: string | null;
  role: Role | null;
}

/**
 * Contas, senhas e sessões. As tabelas de usuários e sessões são fechadas para a aplicação;
 * tudo aqui passa pelas funções app.* do banco.
 */
@Injectable()
export class IdentityService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  get sessionTtlSeconds(): number {
    return this.config.SESSION_TTL_DAYS * 24 * 60 * 60;
  }

  /** Cria a conta, o restaurante e o vínculo de dono. Devolve o token da sessão já aberta. */
  async signup(input: SignupInput): Promise<string> {
    const userId = newId();
    const passwordHash = await hashPassword(input.password);
    try {
      await this.db.platformQuery('SELECT app.signup($1, $2, $3, $4, $5, $6, $7)', [
        userId,
        input.email,
        input.name,
        passwordHash,
        newId(),
        input.storeSlug,
        input.storeName,
      ]);
    } catch (error) {
      const { code, constraint } = error as { code?: string; constraint?: string };
      if (code === '23505' && constraint === 'users_email_key') {
        throw new ConflictException({ error: 'email_taken' });
      }
      if (code === '23505' && constraint === 'tenants_slug_key') {
        throw new ConflictException({ error: 'slug_taken' });
      }
      throw error;
    }
    return this.openSession(userId);
  }

  /** A mensagem de erro é a mesma para e-mail desconhecido e senha errada. */
  async login(input: LoginInput): Promise<string> {
    const { rows } = await this.db.platformQuery<{ user_id: string; password_hash: string }>(
      'SELECT user_id, password_hash FROM app.login_lookup($1)',
      [input.email],
    );
    const account = rows[0];
    const valid = await verifyPassword(input.password, account?.password_hash ?? (await DUMMY_HASH));
    if (!account || !valid) throw new UnauthorizedException({ error: 'invalid_credentials' });
    return this.openSession(account.user_id);
  }

  async logout(token: string): Promise<void> {
    await this.db.platformQuery('SELECT app.revoke_session($1)', [hashToken(token)]);
  }

  async resolveSession(token: string): Promise<AuthContext | null> {
    const { rows } = await this.db.platformQuery<SessionRow>('SELECT * FROM app.session_context($1)', [
      hashToken(token),
    ]);
    const first = rows[0];
    if (!first) return null;
    return {
      userId: first.user_id,
      email: first.email,
      name: first.name,
      stores: rows.flatMap((row) =>
        row.tenant_id && row.tenant_slug && row.tenant_name && row.role
          ? [{ tenantId: row.tenant_id, slug: row.tenant_slug, name: row.tenant_name, role: row.role }]
          : [],
      ),
    };
  }

  private async openSession(userId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.db.platformQuery('SELECT app.create_session($1, $2, $3, $4)', [
      newId(),
      hashToken(token),
      userId,
      this.sessionTtlSeconds,
    ]);
    return token;
  }
}

export function toMeView(auth: AuthContext): MeView {
  return {
    user: { id: auth.userId, name: auth.name, email: auth.email },
    stores: auth.stores.map((store) => ({ slug: store.slug, name: store.name, role: store.role })),
  };
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
