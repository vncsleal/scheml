FROM node:20-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.json ./
COPY packages/scheml/package.json packages/scheml/package.json
COPY apps/website/package.json apps/website/package.json

RUN pnpm install --frozen-lockfile

COPY packages/scheml packages/scheml
COPY apps/website apps/website

RUN pnpm --filter @vncsleal/scheml build
RUN pnpm --filter scheml-website build

FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4321

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/scheml/package.json ./packages/scheml/package.json
COPY --from=build /app/packages/scheml/dist ./packages/scheml/dist
COPY --from=build /app/apps/website/package.json ./apps/website/package.json
COPY --from=build /app/apps/website/dist ./apps/website/dist
COPY --from=build /app/apps/website/demo-bundle ./apps/website/demo-bundle

WORKDIR /app/apps/website

EXPOSE 4321

CMD ["node", "dist/server/entry.mjs"]
