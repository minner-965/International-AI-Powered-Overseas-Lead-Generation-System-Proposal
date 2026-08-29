# Optional services

Place provider adapters and validation services here only when an n8n built-in
node or HTTP Request node is insufficient. Keep provider credentials in n8n's
credential manager or the company secret manager.

`demo-dashboard` is the phase-one review application. It exposes the local REST
API and browser dashboard. It has no outbound messaging integration: human
approval changes only `approval_status`, while `send_status` stays `disabled`.
