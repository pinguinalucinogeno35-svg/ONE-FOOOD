# ONE Food

Plataforma de delivery e gestão para restaurantes. Este repositório é a **Fase 0 (Fundação)** do
[plano de engenharia e escalonamento](https://claude.ai/artifact/PwGXZ8i2iSXZM8AtW6o6y7): a base de código,
o modelo de dados central e as regras de banco que valem desde o primeiro dia, provadas por testes.

A **Fase 1 (Delivery)** está em andamento. Já funciona de ponta a ponta, sem fornecedores externos: o
restaurante cria a conta, monta o cardápio e opera os pedidos num painel ao vivo; o cliente pede pelo
cardápio público, sem app e sem login, e acompanha o pedido.

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

- Criar uma loja: http://localhost:3100/cadastro
- Cardápio de demonstração: http://localhost:3100/demo
- Painel: http://localhost:3100/painel

Outros comandos: `pnpm test` (precisa dos serviços no ar), `pnpm lint`, `pnpm format`, `pnpm typecheck`.

Testes de ponta a ponta, num navegador de verdade (precisam dos serviços no ar e de `pnpm build`):

```bash
pnpm --filter @onefood/e2e exec playwright install chromium
```

```bash
pnpm test:e2e
```

Eles sobem sozinhos a API, os workers, o tempo real e o site em portas próprias (3210 a 3212) e percorrem os
fluxos como uma pessoa faria: cadastro e montagem do cardápio, pedido do cliente até a conclusão no painel,
e acesso ao painel. Cada teste cria a própria loja.

## Estrutura

```
apps/api        Backend: um código, três processos (API, workers, tempo real)
  src/platform    Infraestrutura comum: configuração, banco com contexto de tenant, Redis, saúde
  src/modules     Módulos de negócio: identity, catalog, orders, outbox, realtime
  test            Testes de integração contra Postgres, PgBouncer e Redis de verdade
apps/web        Next.js: cardápio com carrinho, acompanhamento do pedido e painel do restaurante
apps/e2e        Testes de ponta a ponta das telas (Playwright)
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

## API

Público, sem login:

| Rota                                      | O que faz                               |
| ----------------------------------------- | --------------------------------------- |
| `GET /v1/stores/:slug/menu`               | Cardápio da loja                        |
| `POST /v1/stores/:slug/orders`            | Cria o pedido (exige `Idempotency-Key`) |
| `GET /v1/stores/:slug/orders/:id`         | Acompanhamento do pedido pelo cliente   |
| `POST /v1/stores/:slug/coupons/preview`   | Confere um cupom e devolve o desconto   |
| `POST /v1/stores/:slug/orders/:id/review` | Avaliação do pedido concluído           |

Conta:

| Rota                                          | O que faz                                        |
| --------------------------------------------- | ------------------------------------------------ |
| `POST /v1/auth/signup`                        | Cria a conta e o restaurante, e já abre a sessão |
| `POST /v1/auth/login`, `POST /v1/auth/logout` | Abre e encerra a sessão                          |
| `GET /v1/auth/me`                             | Usuário e restaurantes a que tem acesso          |

Painel do restaurante, em `/v1/panel/stores/:slug` (exige sessão e vínculo com a loja):

| Rota                                                     | O que faz                                           | Quem                               |
| -------------------------------------------------------- | --------------------------------------------------- | ---------------------------------- |
| `GET /menu`                                              | Cardápio completo, com itens desativados            | todos                              |
| `PATCH /`                                                | Nome da loja e taxa de entrega                      | dono, gerente                      |
| `POST /categories`, `PATCH /categories/:id`              | Categorias                                          | dono, gerente                      |
| `POST /products`, `PATCH /products/:id`                  | Produtos                                            | dono, gerente                      |
| `PUT /products/:id/option-groups`                        | Substitui os grupos de opções do produto            | dono, gerente                      |
| `GET /orders?scope=open\|recent`                         | Pedidos em andamento ou encerrados nas últimas 24 h | todos                              |
| `POST /orders/:id/status`                                | Avança ou cancela o pedido                          | todos                              |
| `POST /realtime-token`                                   | Token de 60 s para a conexão de tempo real          | todos                              |
| `GET /coupons`, `POST /coupons`, `PATCH /coupons/:id`    | Cupons: listar, criar, ligar e desligar             | criar e desligar: dono, gerente    |
| `GET /reviews`                                           | Média geral, média por prato e avaliações recentes  | todos                              |
| `GET /couriers`, `POST /couriers`, `PATCH /couriers/:id` | Entregadores: listar, cadastrar, alterar e desligar | cadastrar e alterar: dono, gerente |
| `POST /couriers/:id/access-token`                        | Troca o link pessoal do entregador                  | dono, gerente                      |
| `POST /orders/:id/courier`                               | Define ou retira o entregador do pedido             | todos                              |
| `POST /orders/:id/printed`                               | Registra que o pedido foi impresso                  | todos                              |
| `GET /courier-settlements`                               | Acerto pendente por entregador e últimos acertos    | todos                              |
| `POST /courier-settlements`                              | Fecha o acerto de um entregador                     | dono, gerente                      |

Estados do pedido: `pending` → `confirmed` → `preparing` → `ready` → `completed`. Pedido de entrega passa por
`out_for_delivery` antes de concluir. Qualquer estado em aberto pode ir para `cancelled`.

## Telas

| Endereço                     | O que é                                                      |
| ---------------------------- | ------------------------------------------------------------ |
| `/cadastro`, `/entrar`       | Criar a loja e entrar no painel                              |
| `/:slug`                     | Cardápio público com carrinho e finalização do pedido        |
| `/:slug/pedido/:id`          | Acompanhamento do pedido pelo cliente                        |
| `/painel/:slug/pedidos`      | Quadro de pedidos ao vivo                                    |
| `/painel/:slug/cardapio`     | Categorias, produtos e opções                                |
| `/painel/:slug/cupons`       | Cupons de desconto                                           |
| `/painel/:slug/entregadores` | Entregadores e o link pessoal de cada um                     |
| `/entregador/:token`         | Página do entregador: entregas, saída, entrega e localização |
| `/painel/:slug/avaliacoes`   | Notas dos clientes, geral e por prato                        |
| `/painel/:slug/loja`         | Nome da loja e taxa de entrega                               |

- **O navegador fala só com o site.** `app/api/[...path]/route.ts` repassa as chamadas para a API, então o
  cookie de sessão é do próprio site e não há requisição entre origens.
- **Cardápio em cache.** A página do cardápio é guardada por 60 segundos e descartada na hora quando o
  restaurante altera algo no painel.
- **Ícones próprios.** `components/icons.tsx` é o único conjunto de ícones; nenhum emoji ou caractere faz
  papel de ícone.
- **Pix fora da finalização.** O cliente escolhe dinheiro ou cartão na entrega até a integração de Pix existir.

## Entrega com motoboy próprio

Entregador, em `/v1/courier` (exige o token do link pessoal em `Authorization: Bearer`):

| Rota                          | O que faz                                   |
| ----------------------------- | ------------------------------------------- |
| `GET /deliveries`             | Entregas em andamento do próprio entregador |
| `POST /deliveries/:id/status` | Avisa que saiu para entrega ou que entregou |
| `POST /position`              | Envia a posição do aparelho                 |

- **Sem app e sem senha.** O entregador entra por um link pessoal. O banco guarda só o hash do token, e o
  restaurante troca o link quando quiser; o antigo para de funcionar na hora.
- **O entregador só mexe no que é dele.** Pedido de outro entregador, ou sem entregador, responde como
  inexistente. As únicas mudanças que ele faz são "saiu para entrega" e "entregou".
- **Localização é dado pessoal.** Fica guardada só a última posição, no Redis de cache, por 5 minutos. Não há
  histórico de trajeto. O cliente vê a posição só enquanto o pedido está a caminho, e do entregador vê apenas o
  primeiro nome.
- **O entregador decide compartilhar.** A localização só é enviada depois que ele liga, na página dele.
- **Mapa.** O site usa Leaflet com o servidor público do OpenStreetMap, que serve para desenvolvimento e
  demonstração. Em produção, contrate um provedor de mapas e aponte `NEXT_PUBLIC_MAP_TILES_URL` para ele.
- **Acerto.** Para cada entregador, o painel soma as entregas concluídas ainda não acertadas: o que ele tem a
  receber (o valor por entrega do cadastro ou, sem ele, a taxa de entrega de cada pedido) e o dinheiro que
  recebeu em mãos dos clientes. Cartão na entrega e Pix caem direto para o restaurante e não entram.
- **Fechar o acerto** grava os totais como estavam, marca as entregas como acertadas e entra no histórico.
  Mudar depois o valor por entrega não reescreve acertos fechados. O entregador vê a mesma conta na página dele.
- **Fora desta entrega:** rotas e aviso ao entregador por WhatsApp quando um pedido é atribuído.

## Impressão de pedidos

- **Pelo navegador.** O quadro de pedidos imprime na impressora instalada no computador, térmica de 80 ou 58 mm
  ou comum. Não há programa para instalar.
- **Duas vias.** A da cozinha traz o que preparar, em letra grande, sem valores nem dados do cliente. A do
  cliente traz valores, endereço e o que receber. Cada via sai em uma folha, para a impressora cortar entre elas.
- **Ajustes por aparelho.** Quais vias, largura do papel e impressão automática ficam guardados no navegador:
  o computador do balcão pode imprimir sozinho e o tablet da cozinha não.
- **Impressão automática.** Com ela ligada, pedido novo sai sozinho. O servidor registra a primeira impressão
  (`orders.printed_at`), então um pedido já impresso não se repete ao recarregar nem em outro aparelho.
- **Janela de impressão.** O navegador mostra a janela a cada pedido. Para imprimir direto, abra o Chrome com
  `--kiosk-printing` e deixe a impressora térmica como padrão.
- **Fora desta entrega:** impressão direta em impressora térmica sem passar pelo navegador (comandos ESC/POS),
  que exige um programa no computador do restaurante, e impressoras diferentes por setor (cozinha, bar).

## Cupons e avaliações

- **Cupom.** Percentual ou de valor fixo, com pedido mínimo, teto, validade, limite de usos e um uso por
  cliente (pelo telefone). O desconto vale só sobre os itens, nunca sobre a entrega, e quem calcula é o servidor.
- **Limite de usos sob concorrência.** O resgate trava a linha do cupom dentro da transação do pedido.
- **Cancelamento devolve o cupom.** O uso volta para a contagem e o cliente pode usar de novo.
- **Avaliação.** Uma por pedido, só depois de concluído, na própria página de acompanhamento: nota geral,
  nota por prato e comentário. Nota 1 ou 2 avisa o painel na hora.
- **Sem WhatsApp por enquanto.** O plano prevê pedir a avaliação por WhatsApp; hoje o cliente avalia na página
  do pedido. Quando a integração existir, a mensagem só precisa levar o link.

## Segurança de acesso

- **Sessão em cookie** `HttpOnly` e `SameSite=Lax`. O banco guarda só o hash do token; sair encerra a sessão
  no servidor.
- **Senhas** com scrypt. Login responde igual para senha errada e e-mail desconhecido.
- **O tenant vem do vínculo, não do cliente.** Em rotas do painel, o restaurante da URL só vale se o usuário da
  sessão for membro dele; quem não é recebe o mesmo 404 de loja inexistente.
- **Usuários e sessões fechados no banco.** A aplicação não tem acesso direto a essas tabelas, só às funções
  `app.*` de identidade.
- **Limites de uso** no Redis de cache: cadastro, pedidos, conferência de cupom e avaliações por IP, tentativas
  de login por conta, pedidos por loja. Se o Redis cair, o limite deixa passar em vez de parar os pedidos.
- **IP do cliente.** `TRUST_PROXY_HOPS` diz quantos proxies confiáveis há na frente da API. Com o valor errado,
  o limite por IP conta o IP do balanceador ou aceita IP forjado. O site também é um salto: em produção, os
  pedidos chegam à API pelo servidor do site, que precisa entrar nessa conta junto com o balanceador.

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
- **Confirmação de e-mail, recuperação de senha e convite de equipe.** Dependem de um provedor de e-mail.
  Os papéis gerente e funcionário já existem no banco, mas só o dono é criado pelo cadastro.
- **Dois fatores para donos.** Previsto no plano, ainda não implementado.
- **Pix, WhatsApp e impressão.** Dependem da escolha dos provedores. Entram como consumidores dos eventos
  `order.created` e `order.status_changed`.
- **Confirmação de telefone no primeiro pedido.** Hoje a proteção contra pedido falso é só o limite por IP.
- **Identidade visual.** O app web usa um estilo provisório.
- **Aplicativos (garçom, entregador, SmartPOS).** Fase 2.
