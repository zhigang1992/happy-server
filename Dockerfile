# Stage 1: Building the application
FROM oven/bun:1 AS builder

# Install dependencies (bun image is debian-based)
RUN apt-get update && apt-get install -y python3 ffmpeg make g++ build-essential && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package.json and bun.lock
COPY package.json bun.lock ./
COPY ./prisma ./prisma

# Install dependencies
RUN bun install --frozen-lockfile

# Copy the rest of the application code
COPY ./tsconfig.json ./tsconfig.json
COPY ./vitest.config.ts ./vitest.config.ts
COPY ./sources ./sources

# Build the application
RUN bun run build

# Stage 2: Runtime
FROM oven/bun:1 AS runner

WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y python3 ffmpeg && rm -rf /var/lib/apt/lists/*

# Set environment to production
ENV NODE_ENV=production

# Copy necessary files from the builder stage
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/sources ./sources

# Expose the port the app will run on
EXPOSE 3000

# Command to run the application
CMD ["bun", "start"] 