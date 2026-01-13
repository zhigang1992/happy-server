# Stage 1: Building the application
FROM node:22-slim AS builder

# Install dependencies
RUN apt-get update && apt-get install -y --no-install-recommends python3 ffmpeg make g++ build-essential && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package.json and package-lock.json
COPY package.json package-lock.json ./
COPY ./prisma ./prisma

# Install dependencies
RUN npm ci

# Copy the rest of the application code
COPY ./tsconfig.json ./tsconfig.json
COPY ./vitest.config.ts ./vitest.config.ts
COPY ./sources ./sources

# Type check is skipped - tsx handles runtime transpilation
# RUN npm run build

# Stage 2: Runtime
FROM node:22-slim AS runner

WORKDIR /app

# Install dependencies
RUN apt-get update && apt-get install -y --no-install-recommends python3 ffmpeg && rm -rf /var/lib/apt/lists/*

# Set environment to production
ENV NODE_ENV=production

# Copy necessary files from the builder stage
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/sources ./sources

# Expose the port the app will run on
EXPOSE 3000

# Command to run the application
CMD ["npm", "start"]
