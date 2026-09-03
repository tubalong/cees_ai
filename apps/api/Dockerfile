# 占位：依赖与 workspace 构建链路就绪后完善。
# 注意：本应用依赖仓库级 pnpm workspace，构建时请以仓库根为上下文。
FROM node:22-alpine
WORKDIR /app
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile
RUN pnpm build
EXPOSE 3000
CMD ["node", "dist/main.js"]
