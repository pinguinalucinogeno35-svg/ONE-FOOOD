# Imagem única para os três processos do backend. O comando escolhe o processo:
#   API         node --import ./dist/telemetry.js dist/main.api.js      (padrão)
#   workers     node --import ./dist/telemetry.js dist/main.worker.js
#   tempo real  node --import ./dist/telemetry.js dist/main.realtime.js
#   migrações   node dist/migrate.js

FROM node:22-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

# Só os manifestos primeiro: a camada de dependências só é refeita quando eles mudam.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @onefood/api...

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @onefood/api... build
RUN pnpm --filter @onefood/api deploy --prod --legacy /out

FROM node:22-slim
ENV NODE_ENV=production MIGRATIONS_DIR=/app/db/migrations
WORKDIR /app
COPY --from=build /out/package.json ./package.json
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/dist ./dist
COPY db/migrations ./db/migrations
USER node
EXPOSE 3000 3001
CMD ["node", "--import", "./dist/telemetry.js", "dist/main.api.js"]
