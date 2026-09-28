FROM node:22-bookworm-slim AS build
WORKDIR /build
COPY . .
RUN npm test && npm run build && npm run test:build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=5173
WORKDIR /app
COPY --from=build --chown=node:node /build/dist/ ./
USER node
EXPOSE 5173
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
