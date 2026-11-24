# ONE Food

Plataforma de delivery e gestão para restaurantes. Este repositório é a **Fase 0 (Fundação)** do
[plano de engenharia e escalonamento](https://claude.ai/artifact/PwGXZ8i2iSXZM8AtW6o6y7): a base de código,
o modelo de dados central e as regras de banco que valem desde o primeiro dia, provadas por testes.

Ainda não há funcionalidade de produto além de um fluxo de ponta a ponta que exercita a arquitetura:
cardápio público, criação de pedido e aviso em tempo real.

## Como rodar

Pré-requisitos: Node 22, pnpm 10 e Docker.

```bash
pnpm install
```

```bash
cp .env.example .env
```

```bash
pnpm services:up
```

```bash
pnpm build
```

```bash
pnpm db:migrate
```

```bash
pnpm db:seed
```

Depois, cada processo em um terminal:

```bash
pnpm dev:api
```

```bash
pnpm dev:worker
```

```bash
pnpm dev:realtime
```

```bash
pnpm dev:web
```

- Cardápio pela API: http://localhost:3000/v1/stores/demo/menu
- Cardápio no navegador: http://localhost:3100/demo

Outros comandos: `pnpm test` (precisa dos serviços no ar), `pnpm lint`, `pnpm format`, `pnpm typecheck`.

## Estrutura

```
apps/api        Backend: um código, três processos (API, workers, tempo real)
  src/platform    Infraestrutura comum: configuração, banco com contexto de tenant, Redis, saúde
  src/modules     Módulos de negócio: catalog, orders, outbox, realtime
  test            Testes de integração contra Postgres, PgBouncer e Redis de verdade
apps/web        Next.js: cardápio público
packages/shared Tipos e validações compartilhados entre backend e web; dinheiro em centavos
db/migrations   Migrações SQL, aplicadas em ordem por `pnpm db:migrate`
infra/pgbouncer PgBouncer em modo transação, igual ao de produção
loadtest        Teste de carga da criação de pedidos (k6)
```

O backend é um **monólito modular**. Cada módulo é dono das próprias tabelas e fala com os outros só pela
interface pública (`index.ts`) ou por evento. `test/architecture.test.ts` falha se alguém furar essa regra.

## Caminho de um pedido

1. `POST /v1/stores/:slug/orders` com o cabeçalho `Idempotency-Key`. A API calcula os preços a partir do
   cardápio e grava, em **uma transação**: chave de idempotência, cliente, número do pedido, pedido, itens,
   evento, pagamento pendente e o registro no outbox.
2. O relay (processo de workers) lê o outbox e publica na fila.
3. O worker entrega o evento aos consumidores e registra a conclusão. Hoje o único consumidor avisa os painéis.
4. O processo de tempo real repassa o aviso por WebSocket, só para conexões daquele restaurante.

Nada que dependa de terceiros roda dentro da requisição. WhatsApp, Pix, impressão e nota fiscal entram
na Fase 1 como novos consumidores do mesmo evento.

## As sete regras do banco

| Regra                                              | Onde está                                          | Teste que prova                      |
| -------------------------------------------------- | -------------------------------------------------- | ------------------------------------ |
| 1. Multi-tenant por coluna, com Row Level Security | `db/migrations`, `src/platform/db/tenant-db.ts`    | `test/tenancy.test.ts`               |
| 2. Particionamento mensal                          | `0003_orders.sql`, `app.ensure_partitions()`       | `test/partitions.test.ts`            |
| 3. Idempotência em toda entrada                    | `0005_idempotency_outbox.sql`, `orders.service.ts` | `test/orders.test.ts`                |
| 4. Padrão outbox, com reconciliação                | `src/modules/outbox`                               | `test/outbox.test.ts`                |
| 5. Dinheiro em centavos inteiros                   | `packages/shared/src/money.ts`, colunas `*_cents`  | `money.test.ts`, `pricing.test.ts`   |
| 6. Migrações sem parada                            | `src/migrate.ts`                                   | roda antes de toda bateria de testes |
| 7. Relatório fora do primário                      | limite de 5 s por consulta em `tenant-db.ts`       | parcial, ver abaixo                  |

Detalhes que valem conhecer antes de mexer:

- **Tenant por transação.** Todo acesso de negócio passa por `TenantDb.withTenant()`, que fixa o tenant com
  `set_config(..., true)` (o `SET LOCAL`). É o que funciona atrás do PgBouncer em modo transação. Sem esse
  contexto, o banco não devolve linha nenhuma.
- **Três papéis no banco.** O dono das tabelas só roda migrações. `onefood_app` (API e workers) está sujeito ao
  RLS. `onefood_relay` só enxerga a tabela `outbox`.
- **O id do pedido carrega a data.** Pedidos usam UUID versão 7 e `created_at` é o instante embutido no id
  (há um `CHECK` no banco). Quem tem o id sabe a partição, então buscar um pedido toca um único mês.
- **Chaves de idempotência fora das partições.** Índice único em tabela particionada exigiria a coluna de
  partição e quebraria a garantia.
- **Reconciliação.** O Redis pode perder tarefas num failover. Evento publicado e não concluído em 5 minutos
  volta para a fila; depois de 10 tentativas ele para e gera log de erro.
- **Consumidores idempotentes.** O mesmo evento pode chegar mais de uma vez.
- **Migrações.** Uma transação por arquivo, `lock_timeout` de 5 s, trava contra execução simultânea e conferência
  por hash: migração aplicada não se edita, cria-se outra. Mudança de schema segue expandir, migrar, contrair.
- **Regra 7 está parcial.** Só o limite de tempo existe. A réplica de leitura e as tabelas de agregados entram
  junto com os primeiros relatórios.

## Teste de carga

```bash
k6 run -e RATE=150 loadtest/orders.js
```

`RATE=50` é a meta do plano (50 pedidos por segundo por 10 minutos) e `RATE=150` é o critério de saída de fase.
O teste só vale como critério quando roda contra o ambiente de homologação, não contra a máquina local.

## O que ainda não está aqui

- **Infraestrutura como código e deploy.** Dependem da escolha do provedor de nuvem, que o plano deixa em
  cotação. A imagem do backend (`Dockerfile`) já serve aos três processos e às migrações.
- **Autenticação e painel do restaurante.** O servidor de tempo real já exige um token assinado por tenant;
  quem emite esse token é o login do painel, na Fase 1.
- **Limite de requisições por tenant e proteção contra pedido falso.** Fase 1, junto com o lançamento público.
- **Identidade visual.** O app web usa um estilo provisório.
- **Aplicativos (garçom, entregador, SmartPOS).** Fase 2.
