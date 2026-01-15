FROM node:20-bookworm-slim AS frontend-builder
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml .prettierignore .prettierrc components.json tsconfig.json vite.config.ts ./
COPY scripts ./scripts
COPY client ./client
COPY context-engine/pkg ./context-engine/pkg
COPY shared ./shared

RUN pnpm install --frozen-lockfile
RUN pnpm -s exec tsx scripts/verify-wasm-sync.ts
RUN pnpm -s exec vite build

FROM rust:1.83-bookworm AS backend-builder
WORKDIR /app

COPY server-rs/Cargo.toml server-rs/Cargo.lock ./server-rs/
COPY server-rs/src ./server-rs/src

RUN cargo build --release --manifest-path server-rs/Cargo.toml

FROM debian:bookworm-slim AS runtime
WORKDIR /app

RUN useradd -r -u 10001 appuser
USER appuser

COPY --from=backend-builder /app/server-rs/target/release/server-rs /app/server-rs
COPY --from=frontend-builder /app/dist/public /app/public

ENV PORT=3000
ENV STATIC_DIR=/app/public
EXPOSE 3000

CMD ["/app/server-rs"]
