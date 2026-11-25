# Ambiente de demonstração na Railway

Um projeto na Railway com seis serviços. Os quatro primeiros saem deste repositório e são
publicados de novo a cada merge no `main`; os dois últimos são imagens prontas.

| Serviço    | Origem               | Arquivo de configuração        | Endereço público |
| ---------- | -------------------- | ------------------------------ | ---------------- |
| `web`      | `Dockerfile.web`     | `/infra/railway/web.json`      | sim, porta 3100  |
| `api`      | `Dockerfile`         | `/infra/railway/api.json`      | não              |
| `worker`   | `Dockerfile`         | `/infra/railway/worker.json`   | não              |
| `realtime` | `Dockerfile`         | `/infra/railway/realtime.json` | sim, porta 3001  |
| `postgres` | imagem `postgres:16` |                                | não              |
| `redis`    | imagem `redis:7`     |                                | não              |

Em cada serviço do repositório, o caminho do arquivo de configuração vai em Settings, Config
as Code. O arquivo define a imagem, o comando de subida e a verificação de saúde.

Não é a topologia de produção: aqui o Postgres é um contêiner com volume, sem réplica e sem
PgBouncer, e cache e filas dividem o mesmo Redis. Serve para abrir o sistema e clicar.

## O que acontece a cada publicação

Antes de a API nova subir, o serviço `api` roda `node dist/release.js`:

1. garante o papel dono das tabelas e o banco `onefood`;
2. aplica as migrações pendentes;
3. dá login aos papéis da aplicação, com as senhas das URLs de conexão;
4. cria a loja de demonstração (`/demo`) se ela ainda não existir.

Se um passo falha, a publicação para e a versão anterior continua no ar.

## Variáveis

Os valores marcados como segredo são gerados uma vez e guardados só na Railway. As referências
`${{serviço.VARIÁVEL}}` são resolvidas pela própria Railway.

`postgres`: volume em `/var/lib/postgresql/data`.

| Variável            | Valor                             |
| ------------------- | --------------------------------- |
| `POSTGRES_PASSWORD` | segredo                           |
| `PGDATA`            | `/var/lib/postgresql/data/pgdata` |

`redis`: comando de subida `redis-server --maxmemory-policy noeviction`. A instância de filas
nunca pode descartar chaves.

`api`, `worker` e `realtime` recebem o mesmo conjunto:

| Variável                | Valor                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------ |
| `NODE_ENV`              | `production`                                                                         |
| `HOST`                  | `::`                                                                                 |
| `DATABASE_URL`          | `postgres://onefood_app:SEGREDO@${{postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/onefood`   |
| `DATABASE_RELAY_URL`    | `postgres://onefood_relay:SEGREDO@${{postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/onefood` |
| `REDIS_QUEUE_URL`       | `redis://${{redis.RAILWAY_PRIVATE_DOMAIN}}:6379/0?family=0`                          |
| `REDIS_CACHE_URL`       | `redis://${{redis.RAILWAY_PRIVATE_DOMAIN}}:6379/1?family=0`                          |
| `REALTIME_TOKEN_SECRET` | segredo, 32 caracteres ou mais                                                       |
| `REALTIME_PUBLIC_URL`   | `wss://${{realtime.RAILWAY_PUBLIC_DOMAIN}}/ws`                                       |
| `WEB_ORIGIN`            | `https://${{web.RAILWAY_PUBLIC_DOMAIN}}`                                             |
| `TRUST_PROXY_HOPS`      | `1`                                                                                  |

Só no `api`, além das de cima:

| Variável                 | Valor                                                                                                    |
| ------------------------ | -------------------------------------------------------------------------------------------------------- |
| `PORT`                   | `3000`                                                                                                   |
| `DATABASE_ADMIN_URL`     | `postgres://postgres:${{postgres.POSTGRES_PASSWORD}}@${{postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/postgres` |
| `DATABASE_MIGRATION_URL` | `postgres://onefood_owner:SEGREDO@${{postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/onefood`                     |
| `DEMO_OWNER_EMAIL`       | e-mail de entrada do dono da loja de demonstração                                                        |
| `DEMO_OWNER_PASSWORD`    | segredo, 10 caracteres ou mais                                                                           |

Só no `realtime`: `PORT` e `REALTIME_PORT`, os dois com `3001`.

`web`:

| Variável  | Valor                                         |
| --------- | --------------------------------------------- |
| `PORT`    | `3100`                                        |
| `API_URL` | `http://${{api.RAILWAY_PRIVATE_DOMAIN}}:3000` |

## Conferir depois de publicar

```bash
DEMO_URL=https://ENDERECO-DO-WEB DEMO_OWNER_EMAIL=... DEMO_OWNER_PASSWORD=... pnpm --filter @onefood/e2e test:demo
```

Abre o site publicado num navegador: o dono entra no painel, um cliente faz um pedido e o
pedido precisa aparecer no painel sem recarregar. Só passa com site, API, banco, fila,
workers e tempo real ligados entre si.
