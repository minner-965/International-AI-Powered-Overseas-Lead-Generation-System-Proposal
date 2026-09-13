# Manual email and workspace presentation correction

Date: 2026-09-07. Scope: user-reported disabled send control, duplicate/obsolete copy and status presentation. The user separately approved manual single-email delivery and a daily allowance of 50. No actual delivery was requested or performed during this correction.

## Results

1. The disabled send button had two genuine deployment blockers: all prospect sending gates were closed, and the legacy allowance was one email per day, already consumed. The application now permits authenticated manual single-email delivery only, with 50/day, 1/minute, 1/company/30 days. At this historical checkpoint the inspected company row was APPROVED, eligible and `send_allowed=true`, with no send blockers. Other rows retain their actual restrictions, including prior-message identity, stale approval and company frequency limits. Company identity remains in private evidence.
2. Manual API delivery persists the existing outbound identity and uses the existing transport/reservation/approval/suppression checks once. It does not enqueue background delivery. The worker explicitly has sending disabled and rejects replayed send jobs even if their payload claims `manual`. Authenticated MANAGEMENT/SENDER_OPERATOR routes are the only callers supplying the internal manual argument.
3. A temporary manual failure is persisted as FAILED for review, not left QUEUED without a consumer. SMTP ambiguity and unexpected transport exceptions are held for review; no automatic resend is scheduled. Exact-version approval, mailbox verification, suppression and rate checks remain in place.
4. A failed refresh clears stale frontend sending permission. An approved draft's next action reflects sending readiness or its actual blocker rather than incorrectly asking for draft review. A single relevant business-readable reason replaces repetitive setup explanations.
5. Removed seven redundant page kickers and repeated overview labels. Developer-style explanatory paragraphs were shortened to relevant business guidance. Actual source records, original names, scores and evidence were not rewritten. This was a presentation-source audit, not a blanket rewrite of imported evidence or historical exported files.
6. Status badges now use a shared six-pixel rectangular outline, with blue/green/amber/red semantic states and matching bilingual typography. Removed the replaced Phase 5/8 capsule declarations instead of layering a second competing pill style. Email verification and approval states use the same component.
7. Wide desktop tables retain legible columns and use internal horizontal scrolling rather than breaking English words into isolated letters. Phone layouts remain compact lists. Directory filter selections have more room, and the contact-update status area no longer clips immediately below its badge.

## Configuration

`compose.yaml` loads optional ignored `.env.phase12-manual-outreach` for the dashboard only. It contains the user-approved manual gates and daily allowance, no credentials. The existing mailbox credential file was not edited. The optional file must be transferred deliberately when deploying this configuration; its absence does not newly grant sending authority.

| Runtime | Manual-only | Sending | Scope | Live permission |
| --- | --- | --- | --- | --- |
| Dashboard API | true | true | PROSPECT_PILOT | true |
| Outreach worker | true | false | DISABLED | false |

Automatic sending/follow-up email remains off. IMAP and existing reply/CRM processing are preserved. The dashboard and outreach-worker containers were recreated with the current image. No database migrations, research jobs, imports or exports were initiated.

## Verification

- Full suite: **933 total, 879 passed, 54 skipped, zero failures**. Skipped tests are not counted as passes. Existing tests that asserted superseded presentation rules were updated to the new presentation contract while retaining their business assertions.
- Manual-mode tests cover gated entry, payload spoofing, worker replay, pre-provider retry, transport failure, ambiguity and sender-role route protection; no real provider is used by these tests.
- Browser: **13 routes × four widths (1440, 1124, 390, 375) = 52 layout checks**; zero page overflow, page exceptions, HTTP errors or attempted non-GET/HEAD requests.
- Inspected email dialog: sending enabled at all four widths; editing an unsaved subject disables sending at all four widths. The test discarded its unsaved changes, never saved/approved/sent. Button and status screenshots were inspected on desktop and phone.
- Final private browser evidence: `artifacts/phase12-ui-baseline/mail-copy-status/2026-09-07T09-18-56-373Z/result.json`. Earlier 09:13 run correctly recorded the daily allowance blocker; it is not final send-readiness evidence.
- Read-only database snapshots at 09:11:32.101Z and 09:20:49.052Z compare deeply equal after excluding observation time. Companies/sources/contacts 129/364/113; drafts/approvals 9/9; outbound messages/attempts 1/2; real prospect/controlled provider calls 1/1. All collected business aggregates are unchanged. Runtime flags changed only as explicitly authorized; aggregate equality is not a row-by-row checksum.
- Compose validation, current-status validation and diff whitespace checks passed. No real SMTP E2E send is claimed in this task.

## Resource-count question

A browser resource entry is a recorded stylesheet, script, font, image or API response load. A cached entry may transfer zero bytes, so entry count is not identical to wire requests or loading time. The project's 15% threshold is an engineering acceptance rule, not a browser limit, provider restriction or cause of the disabled send button.

The rule can be revised by the user. A reasonable proposed replacement is advisory resource-count reporting plus measured loading/transfer budgets. This task answers the question but does **not** silently waive or delete the existing threshold; earlier performance results remain dated evidence. This targeted correction is not full Phase 12 acceptance. No commit, push or tag was performed.
