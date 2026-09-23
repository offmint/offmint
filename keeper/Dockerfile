# Offmint paper-mode service (read-only mainnet simulation, no keys). Railway: build context = repo root,
# config file = keeper/railway.json, volume at /data.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PAPER_OUT_DIR=/data/paper LOG_DIR=/data/logs BASKET_PATH=/data/basket.json DETECTOR_CACHE=/data/.detector-cache.json
# workspaces: install deps first for layer caching (tsx is needed at runtime, so dev deps are kept)
COPY package.json package-lock.json ./
COPY keeper/package.json keeper/package.json
COPY backtest/package.json backtest/package.json
RUN npm ci --include=dev --ignore-scripts && npm cache clean --force
# runtime inputs: keeper source + the curated ticker list and on-chain facts it reads
COPY keeper/ keeper/
COPY contracts/config/ contracts/config/
EXPOSE 8080
CMD ["npx", "tsx", "keeper/src/service.ts"]
