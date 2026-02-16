# Production Dockerfile for Kubernetes
FROM node:20-slim AS builder

# Install build dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    libvips-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Copy scripts and patches needed for postinstall
COPY scripts ./scripts
COPY patches ./patches

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Build the Strapi admin panel
ENV NODE_ENV=production
RUN npm run build

# Production stage
FROM node:20-slim AS production

# Install runtime dependencies (libvips for Sharp, ffmpeg for video compression)
RUN apt-get update && apt-get install -y \
    libvips \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Copy scripts and patches needed for postinstall
COPY scripts ./scripts
COPY patches ./patches

# Install only production dependencies
RUN npm ci --only=production

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/config ./config
COPY --from=builder /app/src ./src
COPY --from=builder /app/public ./public
COPY --from=builder /app/favicon.png ./favicon.png
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# Create non-root user for security
RUN groupadd -g 1001 strapi && \
    useradd -u 1001 -g strapi -s /bin/sh -m strapi && \
    chown -R strapi:strapi /app

USER strapi

# Expose the default Strapi port
EXPOSE 1337

# Set environment variables
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=1337

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:1337/_health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Start Strapi in production mode
CMD ["npm", "run", "start"]
