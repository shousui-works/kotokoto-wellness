FROM node:24-bookworm-slim

ENV NODE_ENV=production
ENV PORT=8080
ENV TZ=Asia/Tokyo
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

COPY server/ ./server/
COPY dist/ ./dist/

USER node
EXPOSE 8080
CMD ["node", "server/index.mjs"]
