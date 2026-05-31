# Self-Hosting aH-Ha

aH-Ha runs as a set of Node.js processes managed by PM2, backed by MongoDB, PostgreSQL (TimescaleDB), and Redis.

## Requirements

- Node.js 20+
- PM2 (`npm install -g pm2`)
- MongoDB 6+
- PostgreSQL 14+ with TimescaleDB extension
- Redis 7+

## First-time setup

```bash
git clone https://github.com/Enthropic-Data-LLC/ah-ha.git
cd ah-ha

# Install deps
npm install --legacy-peer-deps
cd web && npm install --legacy-peer-deps && cd ..

# Copy and fill in environment variables
cp .env.example .env
$EDITOR .env

# Build backend + frontend
npm run build
cd web && npx vite build && cd ..

# Start all services
pm2 start ecosystem.config.cjs
pm2 save
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | no | API port (default: 3100) |
| `MONGODB_URI` | yes | MongoDB connection string, e.g. `mongodb://user:pass@localhost:27017/ahha?authSource=admin` |
| `TIMESCALE_URI` | yes | PostgreSQL connection string, e.g. `postgresql://user:pass@localhost:5432/ahha` |
| `REDIS_URL` | yes | Redis URL, e.g. `redis://localhost:6379` |
| `JWT_SECRET` | yes | Random secret for session tokens (min 32 chars) |
| `BASE_URL` | yes | Public URL of the instance, e.g. `https://ah-ha.example.com` |
| `EMAIL_FROM` | yes | Sender address for magic links |
| `EMAIL_RELAY_URL` | no | Node-RED or SMTP relay webhook URL for sending email |
| `NODERED_URL` | no | Node-RED base URL for notification delivery |

## Deploying updates

After pulling new code, run the deploy script:

```bash
bash scripts/deploy.sh
```

This pulls from `origin main`, rebuilds backend and frontend, and reloads PM2 with zero downtime.

## PM2 services

| Name | Script | Purpose |
|------|--------|---------|
| `ah-ha-api` | `dist/api.js` | Main HTTP API + static file server |
| `ah-ha-mqtt-bridge` | `dist/mqtt-bridge.js` | MQTT → trail/board ingestion |
| `ah-ha-notifier` | `dist/notifier.js` | Daily briefings + presence notifications |

## Logs

```bash
pm2 logs ah-ha-api
pm2 logs ah-ha-notifier
```
