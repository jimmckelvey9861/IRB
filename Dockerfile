# One image for the web server, the worker and migrations; the command chooses which runs.
#   web:      npm start            (port 3000)
#   worker:   npm run worker
#   migrate:  npm run db:migrate   (run once per release, as the database owner)
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000
RUN useradd --system --uid 1001 irb
COPY --from=build --chown=irb /app ./
USER irb
EXPOSE 3000
CMD ["npm", "start"]
