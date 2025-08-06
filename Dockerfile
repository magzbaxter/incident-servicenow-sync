# Use Node.js 18 LTS
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S incident -u 1001

# Copy package files
COPY package*.json ./

# Install dependencies (including production only)
RUN npm ci --only=production && \
    npm cache clean --force

# Copy application code
COPY src/ ./src/
COPY config/ ./config/

# Create logs directory
RUN mkdir -p logs && \
    chown -R incident:nodejs logs

# Set proper permissions
RUN chown -R incident:nodejs /app

# Switch to non-root user
USER incident

# Port is configured via PORT environment variable - no default EXPOSE

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "const http = require('http'); \
    const port = process.env.PORT; \
    if (!port) { console.error('PORT not set'); process.exit(1); } \
    const req = http.request({ \
      hostname: '127.0.0.1', \
      port: port, \
      path: '/health', \
      method: 'GET' \
    }, (res) => { \
      process.exit(res.statusCode === 200 ? 0 : 1); \
    }); \
    req.on('error', () => process.exit(1)); \
    req.end();"

# Start the application
CMD ["node", "src/index.js"]