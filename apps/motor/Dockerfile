FROM node:22-slim

WORKDIR /app

COPY apps/motor/package.json apps/motor/package-lock.json* ./apps/motor/
RUN npm install --prefix apps/motor --omit=dev

COPY apps/motor ./apps/motor
COPY packages/config ./packages/config

EXPOSE 3100

CMD ["node", "apps/motor/src/server.js"]
