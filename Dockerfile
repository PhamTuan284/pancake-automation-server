# Backend-only image: build with this folder as context (standalone GitHub / Railway repo).
#   docker build -t pancake-api .
# Chromium + system driver for WDIO E2E (same idea as wdio-server Docker images).
# Node 22+: WDIO+Cucumber workers need `require()` of ESM w/ TLA (`--experimental-require-module`).
FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    chromium-driver \
    ca-certificates \
    fonts-liberation \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libasound2 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libxkbcommon0 \
    && rm -rf /var/lib/apt/lists/*

ENV CHROME_BIN=/usr/bin/chromium
ENV CHROMEDRIVER_PATH=/usr/bin/chromedriver
ENV E2E_HEADLESS=1
# WDIO workers use ts-node + `require()` on ESM (Cucumber formatter); Node 22 needs this.
ENV NODE_OPTIONS=--experimental-require-module

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 4001

CMD ["npm", "start"]
