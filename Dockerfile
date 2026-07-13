# Backend API - Node.js with PM2
FROM node:20-alpine

# Proxy for IITD network
ARG HTTP_PROXY
ARG HTTPS_PROXY
ENV HTTP_PROXY=$HTTP_PROXY
ENV HTTPS_PROXY=$HTTPS_PROXY

WORKDIR /app

# Install PM2 globally
RUN npm install -g pm2

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy source code
COPY . .

# Proto contracts for the directory.v1 gRPC listener. This service builds from
# its own context, so it carries a committed copy under protos/ (seeded by the
# workspace protos/sync.sh). PROTO_DIR mirrors api-gateway/search-api so the
# loader resolves the same tree in the image.
COPY protos /app/protos
ENV PROTO_DIR=/app/protos
ENV GRPC_BIND_ADDRESS=0.0.0.0:50055
ENV GRPC_ENABLED=true

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

# 3002 = REST/HTTP (edge + /health healthcheck); 50055 = directory.v1 gRPC mesh
EXPOSE 3002 50055

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3002/', (r) => process.exit(r.statusCode === 200 ? 0 : 1))" || exit 1

CMD ["pm2-runtime", "ecosystem.config.cjs"]
