# Phase 2 Docker Network Verification

Verified: 2026-08-27

## Network topology

All three services share the default Docker Compose network created for the `dpv-leadgen` project.

### Windows host endpoints

```text
Dashboard and Express API: http://127.0.0.1:3000
n8n user interface:        http://127.0.0.1:5678
n8n production webhook:    http://127.0.0.1:5678/webhook/dpv-phase1-research
```

### Container-to-container endpoints

```text
Express -> n8n:
http://n8n:5678/webhook/dpv-phase1-research

n8n -> Express:
http://demo-dashboard:3000/api/research/jobs/:id
http://demo-dashboard:3000/api/research/jobs/:id/status
```

`localhost` is not used for container-to-container calls.

## Configuration variables

```text
N8N_RESEARCH_WEBHOOK_URL
N8N_WEBHOOK_TIMEOUT_MS
APP_INTERNAL_BASE_URL
INTERNAL_API_TOKEN
```

Values used by the local computer are stored in the ignored `.env.phase2` file. The repository `.env.example` contains names and non-secret examples only.

## Connectivity tests

### Express container to n8n container

```text
request: http://n8n:5678/healthz
status: 200
body: {"status":"ok"}
result: PASS
```

### n8n container to Express container

```text
request: http://demo-dashboard:3000/api/health
status: 200
body: {"status":"ok"}
result: PASS
```

### Internal status API without token

```text
request: PATCH /api/research/jobs/:id/status
authorization: omitted
status: 401
result: PASS
```

The browser does not receive or use the internal API token.

## Webhook registration

```text
workflow id: dpvPhase1TwoWeekDemo
workflow active: true
method: POST
path: dpv-phase1-research
```

The active webhook is registered in n8n's `webhook_entity` table.
