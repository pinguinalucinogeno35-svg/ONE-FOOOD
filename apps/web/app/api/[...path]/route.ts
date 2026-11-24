import { revalidateTag } from 'next/cache';
import { menuTag } from '../../../lib/menu-cache';

/**
 * O navegador fala só com o site. Este caminho repassa as chamadas para a API, de modo que
 * o cookie de sessão é do próprio site e não existe requisição entre origens diferentes.
 */
const API_URL = process.env.API_URL ?? 'http://localhost:3000';
const MAX_BODY_BYTES = 256 * 1024;
const REQUEST_HEADERS = [
  'authorization',
  'content-type',
  'cookie',
  'idempotency-key',
  'origin',
  'user-agent',
  'x-forwarded-for',
];
const RESPONSE_HEADERS = ['content-type', 'cache-control'];

export const dynamic = 'force-dynamic';

async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await context.params;
  // Só a API versionada passa por aqui; nada de rotas internas como /health.
  if (path[0] !== 'v1') return Response.json({ error: 'not_found' }, { status: 404 });

  const headers = new Headers();
  for (const name of REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  let body: ArrayBuffer | undefined;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    body = await request.arrayBuffer();
    if (body.byteLength > MAX_BODY_BYTES) return Response.json({ error: 'payload_too_large' }, { status: 413 });
  }

  const target = `${API_URL}/${path.map(encodeURIComponent).join('/')}${new URL(request.url).search}`;
  let upstream: Response;
  try {
    upstream = await fetch(target, { method: request.method, headers, body, redirect: 'manual', cache: 'no-store' });
  } catch {
    return Response.json({ error: 'api_unavailable' }, { status: 502 });
  }

  // Alteração feita no painel de uma loja: o cardápio público dela deixa de valer na hora,
  // em vez de esperar o prazo do cache.
  if (upstream.ok && body !== undefined && path[1] === 'panel' && path[2] === 'stores' && path[3]) {
    revalidateTag(menuTag(path[3]), { expire: 0 });
  }

  const responseHeaders = new Headers();
  for (const name of RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  for (const cookie of upstream.headers.getSetCookie()) responseHeaders.append('set-cookie', cookie);

  const empty = upstream.status === 204 || upstream.status === 304;
  return new Response(empty ? null : await upstream.arrayBuffer(), {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export { proxy as DELETE, proxy as GET, proxy as PATCH, proxy as POST, proxy as PUT };
