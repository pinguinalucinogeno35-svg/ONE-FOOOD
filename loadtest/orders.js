// Teste de carga da criação de pedidos (k6).
//
//   k6 run loadtest/orders.js                              meta: 50 pedidos/s por 10 min
//   k6 run -e RATE=150 loadtest/orders.js                  critério de saída de fase: 3x a meta
//   k6 run -e RATE=50 -e DURATION=30s loadtest/orders.js   verificação rápida
//
// Variáveis: API_URL (padrão http://localhost:3000), STORES (slugs separados por vírgula,
// padrão "demo"), RATE (pedidos por segundo), DURATION.
//
// Com uma loja só, todos os pedidos disputam o mesmo contador de número de pedido:
// é o pior caso. Para simular o tráfego real, passe várias lojas em STORES.

import { check } from 'k6';
import http from 'k6/http';

const API_URL = __ENV.API_URL || 'http://localhost:3000';
const STORES = (__ENV.STORES || 'demo').split(',');
const RATE = Number(__ENV.RATE || 50);

export const options = {
  scenarios: {
    orders: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: __ENV.DURATION || '10m',
      preAllocatedVUs: Math.max(50, RATE),
      maxVUs: RATE * 10,
    },
  },
  thresholds: {
    // Metas do plano: 500 ms no percentil 95 e 99,9% de sucesso.
    'http_req_duration{name:create_order}': ['p(95)<500'],
    'http_req_failed{name:create_order}': ['rate<0.001'],
    // Iteração descartada = o gerador de carga não conseguiu manter a taxa pedida.
    dropped_iterations: ['count==0'],
  },
};

export function setup() {
  return STORES.map((slug) => {
    const res = http.get(`${API_URL}/v1/stores/${slug}/menu`);
    if (res.status !== 200) throw new Error(`cardápio de "${slug}" respondeu ${res.status}`);
    const products = res
      .json()
      .categories.flatMap((category) => category.products)
      .map((product) => ({
        id: product.id,
        // Uma opção de cada grupo obrigatório, para o pedido ser sempre válido.
        optionIds: product.optionGroups
          .filter((group) => group.minSelect > 0)
          .flatMap((group) => group.options.slice(0, group.minSelect).map((option) => option.id)),
      }));
    return { slug, products };
  });
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function idempotencyKey() {
  return `k6-${__VU}-${__ITER}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

export default function (stores) {
  const store = pick(stores);
  const lines = 1 + Math.floor(Math.random() * 3);
  const items = Array.from({ length: lines }, () => {
    const product = pick(store.products);
    return { productId: product.id, quantity: 1 + Math.floor(Math.random() * 2), optionIds: product.optionIds };
  });
  const phone = `+55119${String(10000000 + Math.floor(Math.random() * 89999999))}`;

  const res = http.post(
    `${API_URL}/v1/stores/${store.slug}/orders`,
    JSON.stringify({
      customer: { name: 'Cliente de carga', phone },
      fulfillment: 'pickup',
      paymentMethod: 'pix',
      items,
    }),
    {
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey() },
      tags: { name: 'create_order' },
    },
  );
  check(res, { 'pedido criado (201)': (r) => r.status === 201 });
}
