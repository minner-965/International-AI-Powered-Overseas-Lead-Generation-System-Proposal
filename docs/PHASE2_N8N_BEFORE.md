# Phase 2 — n8n Workflow Before Modification

Recorded: 2026-08-27
Source: running n8n PostgreSQL workflow record and repository workflow export.

## Workflow identity

```text
workflow id: dpvPhase1TwoWeekDemo
workflow name: DPV Phase 1 - Live Public Data Demo
active: false
node count: 4
version id: a421f6cb-6db3-47b5-b448-dc055e0eb177
workflow fingerprint: 13188b465c85b66f93f20fa8b99be863
```

Historical executions before Phase 2:

```text
execution count: 3
successful: 3
failed: 0
```

## Nodes

| Order | Node name | Node type | Current behavior |
|---:|---|---|---|
| 1 | Manual Trigger | `n8n-nodes-base.manualTrigger` | Starts a manual execution |
| 2 | Collect Cumulative Real Data | `n8n-nodes-base.httpRequest` | POSTs `{"limit":50}` to `http://demo-dashboard:3000/api/live/collect` |
| 3 | Load Acceptance Metrics | `n8n-nodes-base.httpRequest` | GETs `http://demo-dashboard:3000/api/metrics` |
| 4 | Human Review Handoff | `n8n-nodes-base.code` | Returns a compact management-review summary |

## Connections

```text
Manual Trigger
  -> Collect Cumulative Real Data
  -> Load Acceptance Metrics
  -> Human Review Handoff
```

There is one linear success path and no workflow error branch.

## Webhook configuration

No webhook node or webhook route exists in the workflow before Phase 2.

## Current behavior

The inactive workflow can be run manually or through the CLI. It invokes the existing synchronous collection endpoint, loads dashboard metrics and produces a summary. The frontend does not trigger this workflow, and the workflow is not linked to a persisted ResearchJob.

Phase 2 will extend this same workflow ID with a ResearchJob webhook control path. Dynamic search, crawling, qualification and lead creation are outside Phase 2.
