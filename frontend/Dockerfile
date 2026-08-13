# Multi-stage: `dev` keeps Vite's own dev server for local development (docker-compose.backend.yml
# builds this stage explicitly via `target: dev`). `build` compiles a production static bundle.
# `prod` serves that bundle with nginx — no development server is ever started or exposed in
# UAT/production (docker-compose.backend.prod.yml builds this stage instead). See UAT readiness
# Phase C: Vite's dev server was flagged as unsuitable for anything beyond a trusted local network
# (unminified, no caching/compression, exposes source, HMR websocket open).

FROM node:20-alpine AS base
WORKDIR /app
COPY package.json ./
# vendor/ must land before `npm install` — package.json's xlsx dependency is a local
# `file:vendor/...tgz` reference (see package.json comment for why), and npm resolves file:
# dependencies at install time, not at COPY . . time below.
COPY vendor ./vendor
RUN npm install
COPY . .

FROM base AS dev
EXPOSE 5173
CMD ["npm", "run", "dev"]

FROM base AS build
# Vite inlines VITE_* variables into the built JS at build time (not read at container runtime),
# so the API base URL must be supplied as a build ARG, not an environment variable on the `prod`
# service — see docker-compose.backend.prod.yml. Defaults to same-origin "/api", matching nginx.conf
# below, which reverse-proxies /api/ to the backend container — no CORS needed when the frontend
# and API are served from the same public origin.
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

FROM nginx:1.27-alpine AS prod
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx-proxy-params.conf /etc/nginx/proxy-params-backend.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
# Explicitly 127.0.0.1, not localhost: /etc/hosts resolves localhost to both 127.0.0.1 and ::1,
# nginx here only binds IPv4 (this image's custom nginx.conf skips the official image's entrypoint
# script that would otherwise auto-add a "listen [::]:80" directive for the stock config), and
# BusyBox wget tries the ::1 result first with no fallback to the working IPv4 address — so
# "wget http://localhost/" fails with "Connection refused" even though the server is healthy and
# serving correctly on 127.0.0.1. Found live during production-stack verification: `docker ps`
# showed this container stuck in "health: starting" indefinitely despite serving real traffic.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ || exit 1
