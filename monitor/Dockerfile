# Conyso Bench Monitor — a standalone continuous-SPC watchdog.
# Tiny: just Node, no build step, no dependencies.
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY index.js spc.js ./
USER node
# Configure via env: MONITOR_SOURCE_URL, MONITOR_COLUMN, MONITOR_INTERVAL_SEC,
# MONITOR_ALERT_WEBHOOK, MONITOR_LABEL.
CMD ["node", "index.js"]
