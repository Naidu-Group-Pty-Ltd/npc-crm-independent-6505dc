# Headless render microservice — Playwright/Chromium with browsers preinstalled.
FROM mcr.microsoft.com/playwright:v1.49.0-jammy

WORKDIR /app

# Install deps first for layer caching.
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY server.js network-policy.js ./

ENV PORT=8080
EXPOSE 8080

# Run as the non-root user shipped in the Playwright image.
USER pwuser

CMD ["node", "server.js"]
