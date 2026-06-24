FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY prisma ./prisma/
RUN npx prisma generate

COPY src ./src/
COPY start.sh ./
RUN chmod +x start.sh

ENV NODE_ENV=production

CMD ["bash", "start.sh"]
