import { createHmac, timingSafeEqual } from 'node:crypto';

const VERSION = 'v1';

/**
 * Token curto que autoriza uma conexão de tempo real a ouvir um único tenant.
 * Quem emite é a API, depois de autenticar o usuário do painel (Fase 1).
 * Formato: v1.<carga em base64url>.<HMAC-SHA256 em base64url>
 */
export function signRealtimeToken(secret: string, tenantId: string, ttlSeconds = 60, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ t: tenantId, e: Math.floor(now / 1000) + ttlSeconds })).toString(
    'base64url',
  );
  return `${VERSION}.${body}.${mac(secret, body)}`;
}

/** Devolve o tenant do token, ou null se o token for inválido ou estiver vencido. */
export function verifyRealtimeToken(secret: string, token: string, now = Date.now()): string | null {
  const [version, body, signature, ...rest] = token.split('.');
  if (version !== VERSION || !body || !signature || rest.length > 0) return null;

  const expected = Buffer.from(mac(secret, body));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;

  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { t?: unknown; e?: unknown };
    if (typeof claims.t !== 'string' || typeof claims.e !== 'number') return null;
    if (claims.e * 1000 <= now) return null;
    return claims.t;
  } catch {
    return null;
  }
}

function mac(secret: string, body: string): string {
  return createHmac('sha256', secret).update(`${VERSION}.${body}`).digest('base64url');
}
