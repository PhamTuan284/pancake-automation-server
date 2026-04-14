# Browser E2E in production: Chromium + system chromedriver (same idea as
# https://github.com/nguyencongcuong/wdio-server/blob/master/Dockerfile ).
# Build from repo root: docker build -f pancake-automation-server/Dockerfile .
FROM node:20-bookworm-slim

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

WORKDIR /app

COPY pancake-automation-server/package.json pancake-automation-server/package-lock.json ./
RUN npm ci

COPY pancake-automation-server/ ./

EXPOSE 4001

CMD ["npm", "start"]
