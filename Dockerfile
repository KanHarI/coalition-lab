# Scheduled data refresh only. The frontend is exported to Firebase Hosting.
FROM node:24-alpine
WORKDIR /app
COPY package.json ./
COPY lib/model.ts lib/dirichlet.ts ./lib/
COPY data/market-slugs.json ./data/
COPY scripts/refresh-markets.mjs ./scripts/
USER node
CMD ["node", "scripts/refresh-markets.mjs"]
