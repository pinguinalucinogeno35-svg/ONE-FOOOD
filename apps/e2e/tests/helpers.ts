import {
  type Browser,
  type BrowserContext,
  devices,
  expect,
  type Locator,
  type Page,
  request as playwrightRequest,
} from '@playwright/test';

const WEB_URL = 'http://localhost:3212';

export interface Store {
  slug: string;
  name: string;
  email: string;
  password: string;
  /** Sessão do dono, pronta para abrir o painel sem passar pela tela de login. */
  storageState: Awaited<ReturnType<BrowserContext['storageState']>>;
}

export function unique(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Cria uma loja pela API, com um cardápio pequeno. Os testes que não são sobre o cadastro
 * começam daqui, cada um com a própria loja: nenhum depende de outro.
 */
export async function createStore(): Promise<Store> {
  const id = unique();
  const store = {
    slug: `loja-${id}`,
    name: `Lanchonete ${id}`,
    email: `dona-${id}@exemplo.com.br`,
    password: 'senha-de-teste-123',
  };
  const api = await playwrightRequest.newContext({ baseURL: WEB_URL });
  const post = async (path: string, data: unknown, method: 'post' | 'put' | 'patch' = 'post') => {
    const response = await api[method](`/api/v1${path}`, { data });
    expect(response.ok(), `${method.toUpperCase()} ${path}: ${response.status()} ${await response.text()}`).toBe(true);
    return (response.status() === 204 ? { id: '' } : await response.json()) as { id: string };
  };

  await post('/auth/signup', {
    name: 'Dona Ana',
    email: store.email,
    password: store.password,
    storeName: store.name,
    storeSlug: store.slug,
  });
  const panel = `/panel/stores/${store.slug}`;
  await post(panel, { deliveryFeeCents: 600 }, 'patch');

  const lanches = await post(`${panel}/categories`, { name: 'Lanches', position: 0 });
  const xSalada = await post(`${panel}/products`, {
    categoryId: lanches.id,
    name: 'X-Salada',
    description: 'Pão, hambúrguer, queijo e salada',
    priceCents: 2800,
  });
  await post(
    `${panel}/products/${xSalada.id}/option-groups`,
    {
      groups: [
        {
          name: 'Ponto da carne',
          minSelect: 1,
          maxSelect: 1,
          options: [{ name: 'Ao ponto' }, { name: 'Bem passado' }],
        },
        { name: 'Adicionais', minSelect: 0, maxSelect: 2, options: [{ name: 'Bacon', priceDeltaCents: 500 }] },
      ],
    },
    'put',
  );
  const bebidas = await post(`${panel}/categories`, { name: 'Bebidas', position: 1 });
  await post(`${panel}/products`, { categoryId: bebidas.id, name: 'Refrigerante lata', priceCents: 700 });

  const storageState = await api.storageState();
  await api.dispose();
  return { ...store, storageState };
}

/** O painel do restaurante, já logado como dono. */
export async function openPanel(browser: Browser, store: Store, section = 'pedidos'): Promise<Page> {
  const context = await browser.newContext({
    storageState: store.storageState,
    viewport: { width: 1280, height: 860 },
  });
  const page = await context.newPage();
  await page.goto(`/painel/${store.slug}/${section}`);
  return page;
}

/** O cardápio público, no celular de um cliente sem conta. */
export async function openStorefront(browser: Browser, slug: string): Promise<Page> {
  const context = await browser.newContext({ ...devices['Pixel 7'], locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  const page = await context.newPage();
  await page.goto(`/${slug}`);
  return page;
}

export async function addRefrigerante(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Refrigerante lata/ }).click();
  await page.getByRole('button', { name: /Adicionar/ }).click();
}

export async function fillCustomer(page: Page, name = 'Carlos Lima'): Promise<void> {
  await page.getByLabel('Seu nome').fill(name);
  await page.getByLabel('Telefone com DDD').fill('(11) 98888-7777');
}

export async function fillAddress(page: Page): Promise<void> {
  await page.getByLabel('CEP').fill('13010-000');
  await page.getByLabel('Rua').fill('Rua das Flores');
  await page.getByLabel('Número').fill('120');
  await page.getByLabel('Bairro').fill('Centro');
  await page.getByLabel('Cidade').fill('Campinas');
  await page.getByLabel('UF').fill('sp');
}

/** Envia o pedido e espera a página de acompanhamento. Devolve o número do pedido. */
export async function placeOrder(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Fazer pedido' }).click();
  const heading = page.getByRole('heading', { name: /^Pedido \d+$/ });
  await expect(heading).toBeVisible();
  return ((await heading.textContent()) ?? '').replace('Pedido ', '');
}

export function currentStep(page: Page): Locator {
  return page.locator('.step[data-state="current"]');
}

/**
 * A mensagem de erro da tela. O Next mantém um anunciador de rotas que também tem
 * role="alert", então o seletor pelo papel sozinho pegaria os dois.
 */
export function errorMessage(page: Page): Locator {
  return page.locator('p[role="alert"]');
}
