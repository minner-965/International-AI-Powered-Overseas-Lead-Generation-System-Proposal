# V3 Component Catalog

Status: implemented component contract, consolidated at WP-UI16. All components inherit UI_SYSTEM_V3, not old styling. Actual verification scope and remaining gaps are recorded in PHASE12_UI_RESULT.md.

| Component family | Required structure and retained capability |
| --- | --- |
| AppShell, Sidebar, SidebarGroup, Topbar | Dark grouped navigation, white bar, gray canvas; preserve routes, active item, Back and mobile focus |
| GlobalSearch, PageHeader | Labeled search with keyboard access; one primary page action; do not invent unavailable search API |
| MetricCard, SectionPanel | Four overview metrics; white 12px panels, light borders/shadow; real value, scope, timestamp |
| StatusBadge, FilterChip | One primary state + one risk per row; visible labels, removable filter keyboard action |
| FilterBar, DataTable, Pagination | Retain filter keys/sort/server pagination; aligned headers; visible page state |
| MobileRecordCard, ContactChannelList | Company-first summary, grouped categories/contacts, detail disclosure; manual channels distinct from email |
| TaskProgress, ActivityTimeline | Persisted stages and real timestamped events; no artificial ETA/progress |
| EmptyState, ErrorState, Skeleton | Contextual blank/error/retry; static skeleton or reduced-motion-compatible feedback; no looping shimmer |
| Drawer, Dialog | Native mechanics; content-sized, one scroll body, visible Back/Close, focus trap and exact restoration |
| ApprovalPanel, EmailComposer | Existing management/draft approval/send gates; three-column desktop composition, stacked mobile; immutable sent content |
| SystemHealth, ChartContainer | Redacted current health; chart title/legend/values/text summary/aria-label; no color-only information |

## Required state contract for every component

| State | Behavior |
| --- | --- |
| loading | Contextual busy label, retain safe previous value with freshness if applicable |
| empty | Explain absence and offer only an existing permitted action; never sample records |
| success | Actual persisted/read result, not optimistic invented business state |
| warning | Specific pending requirement with next action |
| error | Safe readable cause and recovery, preserve input |
| disabled | Visible reason; prevent duplicate submission without hiding context |
| stale | Last update and stale status, no claim of current verification |
| permission denied | Business-readable restriction; no secrets or hidden data in DOM |
| degraded | Partial availability and bounded recovery; do not imply complete service health |

Pure presentational components may mark a state N/A with a reason in their implementation tests; never fabricate state machinery or backend writes to satisfy the catalog.

## Shared interaction acceptance

44px targets, local Tabler decorative icons aria-hidden, named icon-only controls, visible focus, Chinese/English equal typography, long labels/URLs wrap or provide accessible disclosure. Escape closes clean dialogs; unsaved work confirms dismissal. Sticky bars must not hide focus. Filtering and pagination remain usable by keyboard and touch. Reuse capabilities through thin adapters, not copied old visual CSS.
