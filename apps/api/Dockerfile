FROM node:20-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json ./
RUN pnpm install --frozen-lockfile=false
COPY . .
RUN pnpm prisma:generate && pnpm build

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
EXPOSE 3000
CMD ["node", "dist/main.js"]