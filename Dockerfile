FROM node:22-alpine AS base

FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
WORKDIR /app
# `next build` runs in production mode and imports the auth module while collecting                                 
# page data; its top-level guard throws if BETTER_AUTH_SECRET is unset. The build                                   
# never does real auth, so a throwaway value satisfies the guard. The real secret is                                
# injected at runtime from .env in the separate `runner` stage — this placeholder                                   
# does NOT leak into the final image.                                                                               
ENV BETTER_AUTH_SECRET="build-time-placeholder-not-used-at-runtime" 
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/src/db/migrations ./src/db/migrations

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
