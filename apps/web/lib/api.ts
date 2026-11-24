export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly body: Record<string, unknown>,
  ) {
    super(code);
  }
}

interface Options {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT';
  body?: unknown;
  headers?: Record<string, string>;
}

/** Chama a API pelo próprio site (/api/v1/...). O cookie de sessão vai junto sozinho. */
export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.body !== undefined) headers['content-type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'network', {});
  }

  if (response.status === 204) return undefined as T;
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new ApiError(response.status, typeof data.error === 'string' ? data.error : 'unknown', data);
  return data as T;
}

const MESSAGES: Record<string, string> = {
  network: 'Sem conexão. Confira a internet e tente de novo.',
  api_unavailable: 'O sistema está fora do ar por um instante. Tente de novo.',
  invalid_credentials: 'E-mail ou senha incorretos.',
  email_taken: 'Já existe uma conta com este e-mail.',
  slug_taken: 'Este endereço já está em uso. Escolha outro.',
  rate_limited: 'Muitas tentativas em pouco tempo. Aguarde alguns minutos.',
  not_authenticated: 'Sua sessão terminou. Entre de novo.',
  role_not_allowed: 'Seu acesso não permite esta alteração.',
  store_not_found: 'Loja não encontrada.',
  order_not_found: 'Pedido não encontrado.',
  order_invalid: 'Algum item do pedido mudou ou saiu do cardápio. Revise o carrinho.',
  invalid_transition: 'Este pedido já mudou de etapa. A lista foi atualizada.',
  category_not_found: 'Categoria não encontrada.',
  product_not_found: 'Produto não encontrado.',
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'validation_failed') {
      const problems = error.body.problems as Array<{ path: string; detail: string }> | undefined;
      const first = problems?.[0];
      return first ? `Confira o campo ${first.path}: ${first.detail}.` : 'Confira os dados e tente de novo.';
    }
    return MESSAGES[error.code] ?? 'Algo deu errado. Tente de novo.';
  }
  return 'Algo deu errado. Tente de novo.';
}
