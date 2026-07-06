# ===========================================================================
# ATTENDYO GATE — multi-stage build producing a standalone Next.js server.
# On-prem, CPU-only, no cloud at runtime. Listens on 3000 (mapped to 3001 host).
# ===========================================================================

# ---- deps -----------------------------------------------------------------
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# Use a clean, reproducible install. Fall back to `npm install` when no lockfile.
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# ---- builder --------------------------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /app
# NEXT_PUBLIC_* are inlined at build time, so they must be present here.
ARG NEXT_PUBLIC_API_URL=http://localhost:8088
ARG NEXT_PUBLIC_DEVICE_KEY=
ARG NEXT_PUBLIC_CAMERA_ID=
ARG NEXT_PUBLIC_DOOR_ID=
ARG NEXT_PUBLIC_MOCK=0
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_DEVICE_KEY=$NEXT_PUBLIC_DEVICE_KEY \
    NEXT_PUBLIC_CAMERA_ID=$NEXT_PUBLIC_CAMERA_ID \
    NEXT_PUBLIC_DOOR_ID=$NEXT_PUBLIC_DOOR_ID \
    NEXT_PUBLIC_MOCK=$NEXT_PUBLIC_MOCK \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- runner ---------------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# Run as an unprivileged user.
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
