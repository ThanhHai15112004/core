# ==============================================================================
# Stage 1: Build Frontend & Backend
# ==============================================================================
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json pnpm-workspace.yaml* ./
COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/

RUN npm --prefix backend install
RUN npm --prefix frontend install

COPY backend ./backend
COPY frontend ./frontend

RUN npm --prefix backend run build
RUN npm --prefix frontend run build

# ==============================================================================
# Stage 2: Production Runner
# ==============================================================================
FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY package.json pnpm-workspace.yaml* ./
COPY backend/package*.json ./backend/
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/frontend/dist ./frontend/dist
COPY docker/entrypoint.prod.sh /app/docker/entrypoint.prod.sh

RUN npm --prefix backend install --omit=dev && chmod +x /app/docker/entrypoint.prod.sh

EXPOSE 3005

USER node

ENTRYPOINT ["/app/docker/entrypoint.prod.sh"]
