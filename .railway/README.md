# Railway IaC - Serverless-Ready Architecture

Project graph lives in `railway.ts`. [Railway Infrastructure as Code](https://docs.railway.com/infrastructure-as-code) is the replacement for deprecated `railway.toml` Config as Code.

## Architecture

This project uses a **serverless-ready hybrid architecture**:

- **HTTP Handler**: Hono-based HTTP request handler in serverless functions mode
- **Background Tasks**: Triggered via HTTP cron endpoints instead of long-running processes
- **IaC Management**: Service deployed via Railway IaC with infrastructure as code

The application is optimized for serverless execution:
- Stateless HTTP handlers in `packages/board/src/http/handler.ts`
- Background job endpoints in `packages/board/src/http/cron-routes.ts`
- External cron service calls background task endpoints

## Setup

```bash
railway login
railway link
railway config plan
railway config apply
```

## Environment Variables

Required variables (set in Railway dashboard or via IaC):

- `CRON_SECRET`: Secret token for authenticating background job requests
- `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_SLUG`: GitHub App configuration
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_WEBHOOK_SECRET`: GitHub OAuth configuration
- `NODE_ENV`: Set to "production"

## Background Task Endpoints

Background tasks (scheduler, health checks, mailbox flushing) are implemented as secured HTTP endpoints:

```
POST /cron/tick
  - Main periodic tick: scheduler, session management, consensus evaluation
  - Recommended frequency: every 15 seconds
  - Header: x-cron-secret: ${CRON_SECRET}

POST /cron/health-check
  - Connection health monitoring and warning notifications
  - Recommended frequency: every 60 seconds
  - Header: x-cron-secret: ${CRON_SECRET}

POST /cron/flush-mailbox
  - Process queued messages and pending deliveries
  - Recommended frequency: every 30 seconds
  - Header: x-cron-secret: ${CRON_SECRET}
```

## Setting Up External Cron Service

Use any HTTP cron service to trigger the endpoints above:

### Option 1: EasyCron (Free, Recommended)
1. Sign up at https://www.easycron.com/
2. Create cron jobs for each endpoint:
   - URL: `https://<your-railway-domain>/cron/tick`
   - Method: POST
   - Headers: `x-cron-secret: <CRON_SECRET>`
   - Interval: Every 15 seconds

### Option 2: Railway Cron (if available in your tier)
Check [Railway Cron Jobs](https://docs.railway.com/guides/cron-jobs) documentation

### Option 3: Other Services
- Cronitor
- AWS EventBridge
- Google Cloud Scheduler

## Benefits of Serverless-Ready Architecture

- ✅ Scales to zero when idle (via external cron control)
- ✅ Pay only for execution time
- ✅ Stateless design enables easy horizontal scaling
- ✅ Compatible with Railway Functions when available
- ✅ Portable to other serverless platforms (AWS Lambda, Vercel, etc.)

Human-facing deploy steps: [docs/ops/railway.md](../docs/ops/railway.md).
