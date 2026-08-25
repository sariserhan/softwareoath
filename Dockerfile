FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && npm install --global npm@12.0.2
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY bin ./bin
COPY scripts ./scripts
COPY src ./src
COPY migrations ./migrations
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
  && mkdir -p /data/artifacts \
  && chown -R node:node /app /data/artifacts
USER node
EXPOSE 8787
CMD ["node", "--import", "tsx", "scripts/serve.ts"]
