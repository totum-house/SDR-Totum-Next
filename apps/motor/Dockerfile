FROM node:18-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

EXPOSE 3100

CMD ["node", "src/server.js"]
