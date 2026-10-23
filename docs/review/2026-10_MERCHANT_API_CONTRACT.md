# Merchant accounts — API contract (round 4)

Shared contract between backend and frontend work. Developer document.

Model: SIM (ADMIN) creates merchant accounts with a trial (default 7 days). One database; every business row belongs to a merchant (`merchant_id`, NULL = SIM's own data). Merchants never see each other's data. Search runs on SIM's resources within the merchant's monthly quota and SIM's global cap.

## Auth (session cookie, express-session + connect-pg-simple, argon2 hashes)
- `POST /api/auth/login` `{email,password}` → `{user}`; `POST /api/auth/logout`; `GET /api/auth/me` → `{user}` or 401 `AUTH_REQUIRED`.
- `POST /api/auth/password` `{current_password,new_password}`.
- `user = {id,email,display_name,role:'ADMIN'|'MERCHANT',must_change_password:boolean,merchant:null|{id,company_name,sender_name,status,trial_ends_at,paid_until,read_only:boolean,quotas:{monthly_searches,daily_emails},usage:{searches_this_month,emails_today},features:{research:boolean,email:boolean,crm_sync:boolean},referral_code}}`.
- Statuses: `TRIAL`, `ACTIVE` (paid), `EXPIRED` (trial or paid period over → read-only), `DISABLED` (cannot sign in).
- First admin: `node scripts/create-admin.mjs --email … --password …` (also used by the setup script). Existing `DPV_WORKSPACE_ACTOR` env auth stays only as a development fallback when `AUTH_REQUIRED=false`.

## Admin (role ADMIN)
- `GET /api/admin/merchants` → `{items:[{id,company_name,contact_name,login_email,status,trial_ends_at,paid_until,referral_code,referred_by:{id,company_name}|null,quotas,usage:{searches_this_month,emails_today,leads,last_login_at},features,created_at}]}`.
- `POST /api/admin/merchants` `{company_name,contact_name,login_email,trial_days?:7,referred_by_merchant_id?,quotas?:{monthly_searches,daily_emails},features?}` → `{merchant,user,temporary_password}` (shown once; user must change it on first login).
- `PATCH /api/admin/merchants/:id` `{status?,extend_trial_days?,trial_ends_at?,paid_until?,quotas?,features?,company_name?,contact_name?}`.
- `POST /api/admin/merchants/:id/reset-password` → `{temporary_password}`.
- `GET /api/admin/feedback?status=OPEN|DONE` → `{items:[{id,merchant:{id,company_name}|null,user_email,page,message,status,created_at}]}`; `PATCH /api/admin/feedback/:id` `{status}`.
- Admin sees all data; optional `?merchant_id=` filter on list endpoints.

## Merchant self-service (role MERCHANT; ADMIN may use too)
- `GET /api/merchant/onboarding` → `{steps:[{key:'mailbox'|'categories'|'markets'|'first_search',done:boolean}]}`.
- `GET /api/merchant/profile`, `PATCH /api/merchant/profile` `{company_name,sender_name}` (name used in email signatures).
- `GET /api/merchant/mailbox/presets` → `{items:[{key,label,smtp_host,smtp_port,imap_host,imap_port,help_url}]}` (Gmail/Google Workspace, Microsoft 365/Outlook, Zoho, 阿里企业邮箱, 腾讯企业邮箱, 网易企业邮箱, Other).
- `GET /api/merchant/mailbox` → `{configured,from_email,from_name,reply_to,smtp_host,smtp_port,imap_host,imap_port,username,verified_at,last_test:{smtp,imap,at}}` (never returns the password).
- `PUT /api/merchant/mailbox` `{preset_key?,smtp_host,smtp_port,imap_host,imap_port,username,password?,from_email,from_name,reply_to}` (password encrypted AES-256-GCM, key `MERCHANT_SECRET_KEY` in `.env`).
- `POST /api/merchant/mailbox/test-connection` → `{smtp:{ok,code,message},imap:{ok,code,message}}`.
- `POST /api/merchant/mailbox/test-email` → sends one message to the merchant's own from address → `{ok,code}`.
- `GET /api/merchant/scope` / `PUT /api/merchant/scope` `{category_scope_ids:[],market_codes:[]}` — chosen from SIM-approved categories and active markets.
- `POST /api/feedback` `{page,message}` (any signed-in user).

## Scoping and limits on existing endpoints
- Opportunities, companies, CRM pipeline/tasks/timeline/replies/follow-up drafts, research batches/jobs, exports: MERCHANT sees only own rows.
- Errors: 401 `AUTH_REQUIRED`; 403 `MERCHANT_FEATURE_DISABLED`; 403 `MERCHANT_READ_ONLY` (expired: reads allowed, writes refused); 409 `MERCHANT_SEARCH_QUOTA_EXCEEDED`; 409 `MERCHANT_EMAIL_QUOTA_EXCEEDED`; 409 `MERCHANT_MAILBOX_NOT_VERIFIED` (sending requires a verified mailbox).
- Settings, category approval, market toggles, merchant admin: ADMIN only.

## Other round-4 additions
- `GET /api/crm/followup-drafts` → `{items,quota:{sent_today,daily_limit,remaining}}`. `sent_today` is the same count the send gate uses (cold-outreach messages — first touch and follow-ups — reserved, sent or ambiguous since the start of the database day); `daily_limit` = `CRM_FOLLOWUP_DAILY_LIMIT` (default 50), or the merchant's `daily_emails` quota for a merchant user. `quota` is `null` if the count cannot be read.
- Overview metrics: `GET /api/outreach/operations-summary` (the endpoint `overview.js` already reads as `operations`) adds top-level `first_touch:{this_week,last_week,week_start,timezone,week_basis:'ISO_WEEK_MONDAY'}` — introductory emails accepted by the provider (outbound messages that are not CRM follow-ups), counted per ISO week starting Monday 00:00 in `OVERVIEW_WEEK_TIMEZONE` (default `Asia/Shanghai`). For a merchant user the count covers that merchant's messages only.
