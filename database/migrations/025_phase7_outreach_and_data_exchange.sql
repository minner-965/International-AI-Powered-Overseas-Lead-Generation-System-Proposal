BEGIN;

-- Phase 7 is additive.  Historical Phase 5/6 records remain authoritative and
-- are referenced rather than rewritten.

CREATE TABLE IF NOT EXISTS leadgen.marketing_context_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    version text NOT NULL UNIQUE,
    context_status text NOT NULL DEFAULT 'DRAFT'
        CHECK (context_status IN ('DRAFT','PENDING_REVIEW','APPROVED','REJECTED','SUPERSEDED','EXPIRED')),
    allowed_markets text[] NOT NULL DEFAULT '{}',
    allowed_product_profiles text[] NOT NULL DEFAULT '{}',
    target_languages text[] NOT NULL DEFAULT '{}',
    ruleset_version text NOT NULL,
    content jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(content)='object'),
    content_hash text NOT NULL CHECK (content_hash ~ '^[0-9A-Fa-f]{64}$'),
    created_by text NOT NULL,
    submitted_at timestamptz,
    approved_at timestamptz,
    expires_at timestamptz,
    supersedes_version_id uuid REFERENCES leadgen.marketing_context_versions(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (supersedes_version_id IS NULL OR supersedes_version_id <> id)
);

CREATE TABLE IF NOT EXISTS leadgen.marketing_context_approvals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    marketing_context_version_id uuid NOT NULL REFERENCES leadgen.marketing_context_versions(id) ON DELETE RESTRICT,
    content_hash text NOT NULL CHECK (content_hash ~ '^[0-9A-Fa-f]{64}$'),
    approval_digest text NOT NULL CHECK (approval_digest ~ '^[0-9A-Fa-f]{64}$'),
    decision text NOT NULL CHECK (decision IN ('APPROVED','REJECTED','REVOKED')),
    approver_identity text NOT NULL,
    approver_role text NOT NULL,
    reason text,
    approved_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_marketing_context_one_active_approval
    ON leadgen.marketing_context_approvals(marketing_context_version_id,content_hash)
    WHERE decision='APPROVED';

CREATE TABLE IF NOT EXISTS leadgen.business_opportunity_decision_snapshots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES leadgen.companies(id) ON DELETE RESTRICT,
    product_profile text NOT NULL CHECK (product_profile IN ('WOMENSWEAR','GENERAL_MERCHANDISE')),
    research_job_id uuid REFERENCES leadgen.research_jobs(id) ON DELETE RESTRICT,
    buyer_business_model_result_id uuid NOT NULL REFERENCES leadgen.buyer_business_model_results(id) ON DELETE RESTRICT,
    category_procurement_match_result_id uuid NOT NULL REFERENCES leadgen.category_procurement_match_results(id) ON DELETE RESTRICT,
    product_opportunity_result_id uuid REFERENCES leadgen.product_opportunity_results(id) ON DELETE RESTRICT,
    cooperation_feasibility_result_id uuid NOT NULL REFERENCES leadgen.cooperation_feasibility_results(id) ON DELETE RESTRICT,
    system_recommendation_status text NOT NULL
        CHECK (system_recommendation_status IN ('RECOMMENDED','EVIDENCE_REQUIRED','NOT_SUITABLE')),
    contact_readiness text NOT NULL DEFAULT 'EVIDENCE_REQUIRED'
        CHECK (contact_readiness IN ('READY','EVIDENCE_REQUIRED','BLOCKED')),
    policy_contact_status text NOT NULL DEFAULT 'OPEN'
        CHECK (policy_contact_status IN ('OPEN','HOLD')),
    relationship_status text NOT NULL
        CHECK (relationship_status IN ('NEW_PROSPECT','EXISTING_CUSTOMER','HISTORICAL_REVIEW','SUPPRESSED','UNKNOWN')),
    reason_codes text[] NOT NULL DEFAULT '{}',
    rule_version text NOT NULL,
    assessment_revision integer NOT NULL CHECK (assessment_revision >= 1),
    input_digest text NOT NULL CHECK (input_digest ~ '^[0-9A-Fa-f]{64}$'),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (company_id,product_profile,assessment_revision),
    UNIQUE (company_id,product_profile,input_digest),
    UNIQUE (id,company_id,product_profile)
);
CREATE INDEX IF NOT EXISTS idx_business_opportunity_decision_current
    ON leadgen.business_opportunity_decision_snapshots(company_id,product_profile,assessment_revision DESC,created_at DESC);

CREATE TABLE IF NOT EXISTS leadgen.business_opportunity_management_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    decision_snapshot_id uuid NOT NULL,
    company_id uuid NOT NULL,
    product_profile text NOT NULL,
    event_type text NOT NULL
        CHECK (event_type IN ('MANAGEMENT_APPROVED','HOLD','REQUEST_EVIDENCE','REOPEN')),
    management_contact_status text NOT NULL
        CHECK (management_contact_status IN ('NOT_REVIEWED','MANAGEMENT_APPROVED','HOLD')),
    actor_identity text NOT NULL,
    actor_role text NOT NULL CHECK (actor_role IN ('MANAGEMENT','SALES')),
    reason text,
    idempotency_key text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (decision_snapshot_id,company_id,product_profile)
        REFERENCES leadgen.business_opportunity_decision_snapshots(id,company_id,product_profile) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_business_opportunity_management_history
    ON leadgen.business_opportunity_management_events(company_id,product_profile,created_at DESC,id DESC);

CREATE TABLE IF NOT EXISTS leadgen.contact_work_queue (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES leadgen.companies(id) ON DELETE RESTRICT,
    product_profile text NOT NULL CHECK (product_profile IN ('WOMENSWEAR','GENERAL_MERCHANDISE')),
    decision_snapshot_id uuid NOT NULL,
    management_event_id uuid NOT NULL UNIQUE REFERENCES leadgen.business_opportunity_management_events(id) ON DELETE RESTRICT,
    queue_status text NOT NULL DEFAULT 'ACTIVE'
        CHECK (queue_status IN ('ACTIVE','STALE','COMPLETED','CANCELLED')),
    owner_identity text,
    reason_codes text[] NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (decision_snapshot_id,company_id,product_profile)
        REFERENCES leadgen.business_opportunity_decision_snapshots(id,company_id,product_profile) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_work_queue_one_active
    ON leadgen.contact_work_queue(company_id,product_profile)
    WHERE queue_status='ACTIVE';

CREATE OR REPLACE VIEW leadgen.business_opportunity_current AS
WITH current_snapshot AS (
  SELECT DISTINCT ON (company_id,product_profile) *
  FROM leadgen.business_opportunity_decision_snapshots
  ORDER BY company_id,product_profile,assessment_revision DESC,created_at DESC,id DESC
), current_management AS (
  SELECT DISTINCT ON (company_id,product_profile) *
  FROM leadgen.business_opportunity_management_events
  ORDER BY company_id,product_profile,created_at DESC,id DESC
)
SELECT s.*,
       CASE WHEN m.decision_snapshot_id=s.id THEN m.management_contact_status ELSE 'NOT_REVIEWED' END AS management_contact_status,
       m.id AS latest_management_event_id,
       CASE
         WHEN s.policy_contact_status='HOLD' OR (m.decision_snapshot_id=s.id AND m.management_contact_status='HOLD') THEN 'HOLD'
         WHEN s.system_recommendation_status<>'RECOMMENDED' THEN s.system_recommendation_status
         WHEN m.decision_snapshot_id=s.id AND m.event_type='REQUEST_EVIDENCE' THEN 'EVIDENCE_REQUIRED'
         WHEN m.decision_snapshot_id=s.id AND m.management_contact_status='MANAGEMENT_APPROVED' THEN 'MANAGEMENT_APPROVED'
         ELSE s.system_recommendation_status
       END AS display_opportunity_status
FROM current_snapshot s
LEFT JOIN current_management m USING (company_id,product_profile);

CREATE TABLE IF NOT EXISTS leadgen.outreach_eligibility_snapshots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES leadgen.companies(id) ON DELETE RESTRICT,
    product_profile text NOT NULL CHECK (product_profile IN ('WOMENSWEAR','GENERAL_MERCHANDISE')),
    buyer_business_model_result_id uuid NOT NULL REFERENCES leadgen.buyer_business_model_results(id) ON DELETE RESTRICT,
    category_procurement_match_result_id uuid NOT NULL REFERENCES leadgen.category_procurement_match_results(id) ON DELETE RESTRICT,
    product_opportunity_result_id uuid REFERENCES leadgen.product_opportunity_results(id) ON DELETE RESTRICT,
    cooperation_feasibility_result_id uuid NOT NULL REFERENCES leadgen.cooperation_feasibility_results(id) ON DELETE RESTRICT,
    decision_maker_id uuid REFERENCES leadgen.decision_makers(id) ON DELETE RESTRICT,
    eligibility_status text NOT NULL CHECK (eligibility_status IN ('ELIGIBLE','BLOCKED','HOLD')),
    relationship_status text NOT NULL CHECK (relationship_status IN ('NEW_PROSPECT','EXISTING_CUSTOMER','HISTORICAL_REVIEW','SUPPRESSED','UNKNOWN')),
    reason_codes text[] NOT NULL DEFAULT '{}',
    rule_version text NOT NULL,
    input_digest text NOT NULL CHECK (input_digest ~ '^[0-9A-Fa-f]{64}$'),
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (expires_at > created_at),
    UNIQUE (company_id,product_profile,input_digest),
    UNIQUE (id,company_id)
);
CREATE INDEX IF NOT EXISTS idx_outreach_eligibility_company
    ON leadgen.outreach_eligibility_snapshots(company_id,product_profile,created_at DESC);

CREATE TABLE IF NOT EXISTS leadgen.outreach_recipients (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    eligibility_snapshot_id uuid NOT NULL,
    company_id uuid NOT NULL,
    contact_id uuid REFERENCES leadgen.contacts(id) ON DELETE RESTRICT,
    decision_maker_contact_id uuid REFERENCES leadgen.decision_maker_contacts(id) ON DELETE RESTRICT,
    channel text NOT NULL DEFAULT 'EMAIL' CHECK (channel IN ('EMAIL')),
    normalized_recipient text NOT NULL,
    consent_status text NOT NULL DEFAULT 'UNKNOWN'
        CHECK (consent_status IN ('EXPLICIT_OPT_IN','TRANSACTIONAL_RELATIONSHIP','LEGITIMATE_INTEREST_REVIEW','UNKNOWN','OPTED_OUT')),
    verification_status text NOT NULL CHECK (verification_status IN ('VALID','ACCEPT_ALL','UNKNOWN','INVALID','TEMPORARY_ERROR','NOT_VERIFIED','DOMAIN_MX_VERIFIED','PUBLICLY_OBSERVED')),
    verification_provider text,
    verified_at timestamptz,
    lifecycle_status text NOT NULL DEFAULT 'ACTIVE' CHECK (lifecycle_status IN ('ACTIVE','STALE','SUPERSEDED','INVALID','ARCHIVED')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (eligibility_snapshot_id,company_id)
        REFERENCES leadgen.outreach_eligibility_snapshots(id,company_id) ON DELETE RESTRICT,
    CHECK (num_nonnulls(contact_id,decision_maker_contact_id)=1),
    CHECK (btrim(normalized_recipient) <> ''),
    UNIQUE (eligibility_snapshot_id,normalized_recipient),
    UNIQUE (id,company_id)
);
CREATE INDEX IF NOT EXISTS idx_outreach_recipients_active
    ON leadgen.outreach_recipients(company_id,lifecycle_status,verification_status);

CREATE TABLE IF NOT EXISTS leadgen.outreach_drafts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES leadgen.companies(id) ON DELETE RESTRICT,
    eligibility_snapshot_id uuid NOT NULL,
    recipient_id uuid NOT NULL,
    supersedes_draft_id uuid REFERENCES leadgen.outreach_drafts(id) ON DELETE RESTRICT,
    version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
    draft_status text NOT NULL DEFAULT 'DRAFT'
        CHECK (draft_status IN ('DRAFT','INVALID_DRAFT','PENDING_REVIEW','NEEDS_CHANGES','APPROVED','REJECTED','SUPERSEDED','EXPIRED')),
    language text NOT NULL CHECK (language IN ('en','es')),
    subject text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 240),
    body_text text NOT NULL CHECK (char_length(body_text) BETWEEN 1 AND 12000),
    followups jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(followups)='array'),
    personalization_reason text,
    marketing_context_version text NOT NULL REFERENCES leadgen.marketing_context_versions(version) ON DELETE RESTRICT,
    template_version text NOT NULL,
    skill_versions jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(skill_versions)='object'),
    generation_version text NOT NULL,
    input_digest text NOT NULL CHECK (input_digest ~ '^[0-9A-Fa-f]{64}$'),
    content_hash text NOT NULL CHECK (content_hash ~ '^[0-9A-Fa-f]{64}$'),
    policy_warnings text[] NOT NULL DEFAULT '{}',
    created_by text NOT NULL,
    submitted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (eligibility_snapshot_id,company_id)
        REFERENCES leadgen.outreach_eligibility_snapshots(id,company_id) ON DELETE RESTRICT,
    FOREIGN KEY (recipient_id,company_id)
        REFERENCES leadgen.outreach_recipients(id,company_id) ON DELETE RESTRICT,
    CHECK (supersedes_draft_id IS NULL OR supersedes_draft_id <> id),
    UNIQUE (eligibility_snapshot_id,recipient_id,version),
    UNIQUE (id,company_id)
);
CREATE INDEX IF NOT EXISTS idx_outreach_drafts_review
    ON leadgen.outreach_drafts(draft_status,created_at DESC);

CREATE TABLE IF NOT EXISTS leadgen.outreach_draft_evidence (
    draft_id uuid NOT NULL REFERENCES leadgen.outreach_drafts(id) ON DELETE CASCADE,
    prospect_category_observation_id uuid REFERENCES leadgen.prospect_category_observations(id) ON DELETE RESTRICT,
    decision_maker_source_id uuid REFERENCES leadgen.decision_maker_sources(id) ON DELETE RESTRICT,
    company_source_id uuid REFERENCES leadgen.sources(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (num_nonnulls(prospect_category_observation_id,decision_maker_source_id,company_source_id)=1),
    UNIQUE NULLS NOT DISTINCT (draft_id,prospect_category_observation_id,decision_maker_source_id,company_source_id)
);

CREATE TABLE IF NOT EXISTS leadgen.outreach_draft_products (
    draft_id uuid NOT NULL REFERENCES leadgen.outreach_drafts(id) ON DELETE CASCADE,
    product_master_id uuid NOT NULL REFERENCES leadgen.product_master(id) ON DELETE RESTRICT,
    approved_claim_ids text[] NOT NULL DEFAULT '{}',
    display_order integer NOT NULL DEFAULT 1 CHECK (display_order BETWEEN 1 AND 20),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (draft_id,product_master_id),
    UNIQUE (draft_id,display_order)
);

CREATE TABLE IF NOT EXISTS leadgen.outreach_approvals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    draft_id uuid NOT NULL REFERENCES leadgen.outreach_drafts(id) ON DELETE RESTRICT,
    recipient_id uuid NOT NULL REFERENCES leadgen.outreach_recipients(id) ON DELETE RESTRICT,
    company_id uuid NOT NULL REFERENCES leadgen.companies(id) ON DELETE RESTRICT,
    draft_version integer NOT NULL CHECK (draft_version >= 1),
    normalized_recipient text NOT NULL CHECK (btrim(normalized_recipient) <> ''),
    product_profile text NOT NULL CHECK (product_profile IN ('WOMENSWEAR','GENERAL_MERCHANDISE')),
    content_hash text NOT NULL CHECK (content_hash ~ '^[0-9A-Fa-f]{64}$'),
    approval_digest text NOT NULL CHECK (approval_digest ~ '^[0-9A-Fa-f]{64}$'),
    evidence_snapshot_hash text NOT NULL CHECK (evidence_snapshot_hash ~ '^[0-9A-Fa-f]{64}$'),
    from_identity text NOT NULL,
    reply_to text NOT NULL,
    channel text NOT NULL CHECK (channel='EMAIL'),
    decision text NOT NULL CHECK (decision IN ('APPROVED','REJECTED','REVOKED')),
    approver_identity text NOT NULL,
    approver_role text NOT NULL,
    reason text,
    approved_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (draft_id,draft_version,content_hash,decision,approved_at),
    FOREIGN KEY (recipient_id,company_id)
        REFERENCES leadgen.outreach_recipients(id,company_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_outreach_one_active_approval
    ON leadgen.outreach_approvals(draft_id,draft_version,content_hash,normalized_recipient,from_identity,reply_to)
    WHERE decision='APPROVED';
CREATE UNIQUE INDEX IF NOT EXISTS idx_outreach_approval_digest
    ON leadgen.outreach_approvals(approval_digest)
    WHERE decision='APPROVED';

CREATE TABLE IF NOT EXISTS leadgen.outbound_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES leadgen.companies(id) ON DELETE RESTRICT,
    recipient_id uuid NOT NULL REFERENCES leadgen.outreach_recipients(id) ON DELETE RESTRICT,
    approval_id uuid NOT NULL UNIQUE REFERENCES leadgen.outreach_approvals(id) ON DELETE RESTRICT,
    provider text NOT NULL CHECK (provider IN ('NONE','SMTP','RESEND')),
    provider_purpose text NOT NULL CHECK (provider_purpose IN ('COLD_OUTREACH','OPT_IN','TRANSACTIONAL')),
    idempotency_key text NOT NULL UNIQUE,
    send_status text NOT NULL DEFAULT 'QUEUED'
        CHECK (send_status IN ('QUEUED','BLOCKED','SENDING','PROVIDER_ACCEPTED','DELIVERED','SOFT_BOUNCED','HARD_BOUNCED','FAILED','CANCELLED')),
    reason_codes text[] NOT NULL DEFAULT '{}',
    provider_message_id text,
    queued_at timestamptz NOT NULL DEFAULT now(),
    sent_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_outbound_messages_status
    ON leadgen.outbound_messages(send_status,queued_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_outbound_messages_provider_message_id
    ON leadgen.outbound_messages(provider,provider_message_id)
    WHERE provider_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS leadgen.outbound_message_attempts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    outbound_message_id uuid NOT NULL REFERENCES leadgen.outbound_messages(id) ON DELETE RESTRICT,
    attempt_number integer NOT NULL CHECK (attempt_number >= 1),
    attempt_status text NOT NULL CHECK (attempt_status IN ('STARTED','BLOCKED','RETRYABLE_ERROR','PERMANENT_ERROR','ACCEPTED')),
    provider text NOT NULL,
    reason_codes text[] NOT NULL DEFAULT '{}',
    response_code text,
    response_digest text CHECK (response_digest IS NULL OR response_digest ~ '^[0-9A-Fa-f]{64}$'),
    provider_call_started_at timestamptz,
    started_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    UNIQUE (outbound_message_id,attempt_number)
);

CREATE TABLE IF NOT EXISTS leadgen.email_webhook_inbox (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider text NOT NULL,
    provider_event_id text NOT NULL,
    signature_status text NOT NULL CHECK (signature_status IN ('VERIFIED','INVALID','MISSING')),
    event_type text,
    raw_body_digest text NOT NULL CHECK (raw_body_digest ~ '^[0-9A-Fa-f]{64}$'),
    sanitized_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    processing_status text NOT NULL DEFAULT 'RECEIVED' CHECK (processing_status IN ('RECEIVED','PROCESSED','REVIEW','REJECTED','FAILED')),
    received_at timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz,
    UNIQUE (provider,provider_event_id)
);

CREATE TABLE IF NOT EXISTS leadgen.email_message_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    outbound_message_id uuid REFERENCES leadgen.outbound_messages(id) ON DELETE RESTRICT,
    webhook_inbox_id uuid REFERENCES leadgen.email_webhook_inbox(id) ON DELETE RESTRICT,
    event_type text NOT NULL CHECK (event_type IN ('QUEUED','PROVIDER_ACCEPTED','DELIVERED','DELIVERY_DELAYED','SOFT_BOUNCED','HARD_BOUNCED','COMPLAINED','OPTED_OUT','OPENED','CLICKED','REPLIED','FAILED','BLOCKED')),
    occurred_at timestamptz NOT NULL,
    provider_sequence text,
    event_digest text NOT NULL CHECK (event_digest ~ '^[0-9A-Fa-f]{64}$'),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (event_digest)
);

CREATE TABLE IF NOT EXISTS leadgen.outreach_threads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES leadgen.companies(id) ON DELETE RESTRICT,
    recipient_id uuid NOT NULL REFERENCES leadgen.outreach_recipients(id) ON DELETE RESTRICT,
    thread_token text NOT NULL UNIQUE,
    thread_status text NOT NULL DEFAULT 'OPEN' CHECK (thread_status IN ('OPEN','REPLIED','MANUAL_TAKEOVER','CLOSED','SUPPRESSED')),
    last_message_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (company_id,recipient_id)
);

CREATE TABLE IF NOT EXISTS leadgen.inbound_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider text NOT NULL,
    provider_message_id text NOT NULL,
    webhook_inbox_id uuid REFERENCES leadgen.email_webhook_inbox(id) ON DELETE RESTRICT,
    thread_id uuid REFERENCES leadgen.outreach_threads(id) ON DELETE RESTRICT,
    correlation_status text NOT NULL DEFAULT 'REVIEW' CHECK (correlation_status IN ('MATCHED','REVIEW','UNMATCHED')),
    from_address_hash text NOT NULL CHECK (from_address_hash ~ '^[0-9A-Fa-f]{64}$'),
    subject_sanitized text,
    body_text_sanitized text,
    attachment_status text NOT NULL DEFAULT 'NONE' CHECK (attachment_status IN ('NONE','ISOLATED','REJECTED','REVIEW')),
    received_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (provider,provider_message_id)
);

CREATE TABLE IF NOT EXISTS leadgen.reply_classifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    inbound_message_id uuid NOT NULL REFERENCES leadgen.inbound_messages(id) ON DELETE RESTRICT,
    intent text NOT NULL CHECK (intent IN ('CATALOGUE','SAMPLE','QUOTATION','MEETING','DEFER','DECLINE','OPT_OUT','AUTO_REPLY','IRRELEVANT','REVIEW')),
    confidence numeric(5,4) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
    review_status text NOT NULL DEFAULT 'PENDING_REVIEW' CHECK (review_status IN ('PENDING_REVIEW','CONFIRMED','CORRECTED','REJECTED')),
    classifier_version text NOT NULL,
    reason_codes text[] NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    reviewed_by text,
    reviewed_at timestamptz
);

CREATE TABLE IF NOT EXISTS leadgen.contact_suppressions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES leadgen.companies(id) ON DELETE RESTRICT,
    contact_id uuid REFERENCES leadgen.contacts(id) ON DELETE RESTRICT,
    decision_maker_contact_id uuid REFERENCES leadgen.decision_maker_contacts(id) ON DELETE RESTRICT,
    normalized_recipient_hash text CHECK (normalized_recipient_hash IS NULL OR normalized_recipient_hash ~ '^[0-9A-Fa-f]{64}$'),
    suppression_type text NOT NULL CHECK (suppression_type IN ('INVALID_EMAIL','HARD_BOUNCE','SOFT_BOUNCE_LIMIT','OPT_OUT','COMPLAINT','MANUAL','PROVIDER_SUPPRESSED')),
    reason text NOT NULL,
    source_event_id uuid REFERENCES leadgen.email_message_events(id) ON DELETE RESTRICT,
    recorded_by text NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    lifted_at timestamptz,
    CHECK (num_nonnulls(contact_id,decision_maker_contact_id,normalized_recipient_hash)=1)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_suppressions_active_contact
    ON leadgen.contact_suppressions(company_id,coalesce(contact_id,'00000000-0000-0000-0000-000000000000'::uuid),coalesce(decision_maker_contact_id,'00000000-0000-0000-0000-000000000000'::uuid),coalesce(normalized_recipient_hash,''),suppression_type)
    WHERE lifted_at IS NULL;

CREATE TABLE IF NOT EXISTS leadgen.sales_tasks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES leadgen.companies(id) ON DELETE RESTRICT,
    thread_id uuid REFERENCES leadgen.outreach_threads(id) ON DELETE RESTRICT,
    inbound_message_id uuid REFERENCES leadgen.inbound_messages(id) ON DELETE RESTRICT,
    task_type text NOT NULL CHECK (task_type IN ('VERIFY_CONTACT','REVIEW_ACCEPT_ALL','REVIEW_DRAFT','FOLLOW_UP','REPLY_REVIEW','QUOTATION','SAMPLE','MEETING','CRM_HANDOFF','OTHER')),
    task_status text NOT NULL DEFAULT 'OPEN' CHECK (task_status IN ('OPEN','IN_PROGRESS','COMPLETED','CANCELLED')),
    owner text,
    due_at timestamptz,
    details jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leadgen.crm_sync_outbox (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES leadgen.companies(id) ON DELETE RESTRICT,
    task_id uuid REFERENCES leadgen.sales_tasks(id) ON DELETE RESTRICT,
    operation text NOT NULL CHECK (operation IN ('CREATE_LEAD','UPDATE_ACTIVITY','CREATE_TASK','UPDATE_OPPORTUNITY','SUPPRESSION_NOTICE')),
    payload jsonb NOT NULL,
    idempotency_key text NOT NULL UNIQUE,
    sync_status text NOT NULL DEFAULT 'PENDING' CHECK (sync_status IN ('PENDING','PROCESSING','SYNCED','RETRYABLE_ERROR','PERMANENT_ERROR','CANCELLED')),
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_attempt_at timestamptz,
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Extend existing provenance-aware import infrastructure; all prior values are
-- preserved in the replacement allowlists.
ALTER TABLE leadgen.reference_data_imports DROP CONSTRAINT IF EXISTS reference_data_imports_import_type_check;
ALTER TABLE leadgen.reference_data_imports ADD CONSTRAINT reference_data_imports_import_type_check CHECK (import_type IN (
    'HISTORICAL_CUSTOMERS','HISTORICAL_ORDERS','HISTORICAL_LEAD_OUTCOMES','HISTORICAL_CUSTOMER_CHANNELS',
    'CUSTOMER_ALIASES','PRODUCT_MASTER','ORDER_LINES','HISTORICAL_CONTACTS','HISTORICAL_ACTIVITIES',
    'PROSPECT_LEADS','PRODUCT_MASTER_UPDATE','CUSTOMER_DEALS','CUSTOMER_DEAL_LINES'
));

ALTER TABLE leadgen.reference_data_imports
    ADD COLUMN IF NOT EXISTS schema_version text NOT NULL DEFAULT 'legacy',
    ADD COLUMN IF NOT EXISTS dry_run_passed boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS dry_run_digest text,
    ADD COLUMN IF NOT EXISTS dry_run_passed_at timestamptz;
ALTER TABLE leadgen.reference_data_imports
    DROP CONSTRAINT IF EXISTS reference_data_imports_dataset_role_check,
    DROP CONSTRAINT IF EXISTS reference_data_imports_dry_run_digest_check,
    DROP CONSTRAINT IF EXISTS reference_data_imports_dry_run_contract_check;
ALTER TABLE leadgen.reference_data_imports
    ADD CONSTRAINT reference_data_imports_dataset_role_check CHECK (dataset_role IN (
        'CONVERTED_ORDER_HISTORY','CRM_LEAD_HISTORY','CRM_CONTACT_HISTORY','CRM_ACTIVITY_HISTORY','WIN_LOSS_HISTORY','UNKNOWN',
        'PROSPECT_IMPORT','PRODUCT_CATALOG_UPDATE'
    )),
    ADD CONSTRAINT reference_data_imports_dry_run_digest_check
        CHECK (dry_run_digest IS NULL OR dry_run_digest ~ '^[0-9A-Fa-f]{64}$'),
    ADD CONSTRAINT reference_data_imports_dry_run_contract_check
        CHECK (NOT dry_run_passed OR (dry_run_digest IS NOT NULL AND dry_run_passed_at IS NOT NULL));

CREATE TABLE IF NOT EXISTS leadgen.import_approvals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    import_id uuid NOT NULL REFERENCES leadgen.reference_data_imports(id) ON DELETE RESTRICT,
    decision text NOT NULL CHECK (decision IN ('APPROVED','REJECTED','REVOKED')),
    dry_run_digest text NOT NULL CHECK (dry_run_digest ~ '^[0-9A-Fa-f]{64}$'),
    source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9A-Fa-f]{64}$'),
    approver_identity text NOT NULL,
    approver_role text NOT NULL,
    reason text,
    idempotency_key text NOT NULL UNIQUE,
    decided_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_import_one_active_approval
    ON leadgen.import_approvals(import_id,dry_run_digest,source_sha256)
    WHERE decision='APPROVED';

CREATE TABLE IF NOT EXISTS leadgen.product_master_revisions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_master_id uuid NOT NULL REFERENCES leadgen.product_master(id) ON DELETE RESTRICT,
    source_import_id uuid NOT NULL REFERENCES leadgen.reference_data_imports(id) ON DELETE RESTRICT,
    source_import_row_id uuid NOT NULL REFERENCES leadgen.reference_data_import_rows(id) ON DELETE RESTRICT,
    supersedes_revision_id uuid REFERENCES leadgen.product_master_revisions(id) ON DELETE RESTRICT,
    superseded_by_revision_id uuid REFERENCES leadgen.product_master_revisions(id) ON DELETE RESTRICT,
    revision_number integer NOT NULL CHECK (revision_number >= 1),
    product_profile text NOT NULL CHECK (product_profile IN ('WOMENSWEAR','GENERAL_MERCHANDISE','UNKNOWN')),
    category text,
    subcategory text,
    revision_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(revision_payload)='object'),
    catalog_status text NOT NULL CHECK (catalog_status IN ('ACTIVE','INACTIVE','REVIEW','UNKNOWN')),
    effective_date date,
    approval_status text NOT NULL DEFAULT 'REVIEW' CHECK (approval_status IN ('REVIEW','APPROVED','REJECTED','SUPERSEDED')),
    approved_by text,
    approved_at timestamptz,
    record_digest text NOT NULL CHECK (record_digest ~ '^[0-9A-Fa-f]{64}$'),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (supersedes_revision_id IS NULL OR supersedes_revision_id <> id),
    CHECK (superseded_by_revision_id IS NULL OR superseded_by_revision_id <> id),
    CHECK (
        (approval_status IN ('APPROVED','SUPERSEDED') AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
        OR (approval_status IN ('REVIEW','REJECTED') AND approved_by IS NULL AND approved_at IS NULL)
    ),
    CHECK ((approval_status='SUPERSEDED') = (superseded_by_revision_id IS NOT NULL)),
    UNIQUE (product_master_id,revision_number),
    UNIQUE (source_import_row_id),
    UNIQUE (record_digest)
);
CREATE INDEX IF NOT EXISTS idx_product_master_revisions_current
    ON leadgen.product_master_revisions(product_master_id,approval_status,revision_number DESC);

CREATE OR REPLACE VIEW leadgen.product_master_current_revisions AS
SELECT DISTINCT ON (r.product_master_id)
    r.product_master_id,r.id AS product_master_revision_id,r.revision_number,
    r.product_profile,r.category,r.subcategory,r.revision_payload,r.catalog_status,
    r.effective_date,r.record_digest,r.approved_at
FROM leadgen.product_master_revisions r
WHERE r.approval_status='APPROVED'
ORDER BY r.product_master_id,r.revision_number DESC,r.created_at DESC;

CREATE TABLE IF NOT EXISTS leadgen.data_export_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    export_type text NOT NULL CHECK (export_type IN ('LEAD_MASTER_INTERNAL','SALES_OPPORTUNITY','PRODUCT_CATALOG_INTERNAL','CUSTOMER_DEAL_HISTORY','IMPORT_ERROR_REPORT')),
    export_format text NOT NULL CHECK (export_format IN ('CSV','XLSX')),
    export_mode text NOT NULL CHECK (export_mode IN ('CURRENT_FILTER','SELECTED_ROWS','FULL_AUTHORIZED_MASTER')),
    schema_version text NOT NULL,
    requester_identity text NOT NULL,
    requester_role text NOT NULL,
    requested_columns text[] NOT NULL DEFAULT '{}',
    applied_columns text[] NOT NULL DEFAULT '{}',
    filters jsonb NOT NULL DEFAULT '{}'::jsonb,
    selected_entity_ids uuid[] NOT NULL DEFAULT '{}',
    export_status text NOT NULL DEFAULT 'QUEUED' CHECK (export_status IN ('QUEUED','PROCESSING','READY','FAILED','EXPIRED','CANCELLED')),
    request_digest text NOT NULL CHECK (request_digest ~ '^[0-9A-Fa-f]{64}$'),
    storage_provider text NOT NULL DEFAULT 'LOCAL_EXPORT_DIRECTORY' CHECK (storage_provider IN ('LOCAL_EXPORT_DIRECTORY')),
    storage_key text,
    snapshot_at timestamptz NOT NULL DEFAULT now(),
    row_count integer CHECK (row_count IS NULL OR row_count >= 0),
    file_sha256 text CHECK (file_sha256 IS NULL OR file_sha256 ~ '^[0-9A-Fa-f]{64}$'),
    internal_file_path text,
    download_token_hash text CHECK (download_token_hash IS NULL OR download_token_hash ~ '^[0-9A-Fa-f]{64}$'),
    download_token_issued_at timestamptz,
    download_token_expires_at timestamptz,
    file_expires_at timestamptz,
    last_downloaded_at timestamptz,
    error_code text,
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    CHECK (export_mode <> 'SELECTED_ROWS' OR cardinality(selected_entity_ids) > 0),
    CHECK (
        export_status <> 'READY'
        OR (
            row_count IS NOT NULL
            AND file_sha256 IS NOT NULL
            AND internal_file_path IS NOT NULL
            AND storage_key IS NOT NULL
            AND download_token_hash IS NOT NULL
            AND download_token_issued_at IS NOT NULL
            AND download_token_expires_at IS NOT NULL
            AND file_expires_at IS NOT NULL
        )
    )
);
CREATE INDEX IF NOT EXISTS idx_data_export_jobs_requester
    ON leadgen.data_export_jobs(requester_identity,created_at DESC);

CREATE TABLE IF NOT EXISTS leadgen.data_export_download_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    export_job_id uuid NOT NULL REFERENCES leadgen.data_export_jobs(id) ON DELETE RESTRICT,
    requester_identity text NOT NULL,
    authorization_status text NOT NULL CHECK (authorization_status IN ('AUTHORIZED','DENIED','EXPIRED')),
    downloaded_at timestamptz NOT NULL DEFAULT now(),
    request_digest text NOT NULL CHECK (request_digest ~ '^[0-9A-Fa-f]{64}$')
);
CREATE INDEX IF NOT EXISTS idx_data_export_download_audit
    ON leadgen.data_export_download_events(export_job_id,downloaded_at DESC);

CREATE OR REPLACE FUNCTION leadgen.prevent_phase7_audit_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% is append-only; create a new event/version instead', TG_TABLE_NAME;
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'marketing_context_approvals',
    'business_opportunity_decision_snapshots','business_opportunity_management_events',
    'outreach_eligibility_snapshots','outreach_approvals',
    'email_message_events','import_approvals','data_export_download_events'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON leadgen.%I','trg_' || t || '_immutable',t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON leadgen.%I FOR EACH ROW EXECUTE FUNCTION leadgen.prevent_phase7_audit_mutation()','trg_' || t || '_immutable',t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION leadgen.enforce_phase7_contact_queue()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_row leadgen.business_opportunity_current%ROWTYPE;
DECLARE management_row leadgen.business_opportunity_management_events%ROWTYPE;
BEGIN
  IF NEW.queue_status<>'ACTIVE' THEN RETURN NEW; END IF;
  SELECT * INTO current_row
  FROM leadgen.business_opportunity_current
  WHERE company_id=NEW.company_id AND product_profile=NEW.product_profile;
  SELECT * INTO management_row
  FROM leadgen.business_opportunity_management_events
  WHERE id=NEW.management_event_id;
  IF current_row.id IS NULL
     OR current_row.id<>NEW.decision_snapshot_id
     OR current_row.display_opportunity_status<>'MANAGEMENT_APPROVED'
     OR management_row.decision_snapshot_id<>NEW.decision_snapshot_id
     OR management_row.event_type<>'MANAGEMENT_APPROVED' THEN
    RAISE EXCEPTION 'active contact queue requires the current MANAGEMENT_APPROVED decision snapshot';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_contact_work_queue_gate ON leadgen.contact_work_queue;
CREATE TRIGGER trg_contact_work_queue_gate
    BEFORE INSERT OR UPDATE OF queue_status,decision_snapshot_id,management_event_id
    ON leadgen.contact_work_queue
    FOR EACH ROW EXECUTE FUNCTION leadgen.enforce_phase7_contact_queue();

CREATE OR REPLACE FUNCTION leadgen.stale_phase7_contact_queue()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE leadgen.contact_work_queue
     SET queue_status='STALE',updated_at=now(),reason_codes=array_append(reason_codes,'DECISION_SNAPSHOT_SUPERSEDED')
   WHERE company_id=NEW.company_id AND product_profile=NEW.product_profile
     AND queue_status='ACTIVE' AND decision_snapshot_id<>NEW.id;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_business_opportunity_snapshot_stale_queue ON leadgen.business_opportunity_decision_snapshots;
CREATE TRIGGER trg_business_opportunity_snapshot_stale_queue
    AFTER INSERT ON leadgen.business_opportunity_decision_snapshots
    FOR EACH ROW EXECUTE FUNCTION leadgen.stale_phase7_contact_queue();

CREATE OR REPLACE FUNCTION leadgen.protect_phase7_version_payload()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='marketing_context_versions' AND (
       NEW.version IS DISTINCT FROM OLD.version
    OR NEW.allowed_markets IS DISTINCT FROM OLD.allowed_markets
    OR NEW.allowed_product_profiles IS DISTINCT FROM OLD.allowed_product_profiles
    OR NEW.target_languages IS DISTINCT FROM OLD.target_languages
    OR NEW.ruleset_version IS DISTINCT FROM OLD.ruleset_version
    OR NEW.content IS DISTINCT FROM OLD.content
    OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
  ) THEN
    RAISE EXCEPTION 'marketing context version payload is immutable';
  END IF;
  IF TG_TABLE_NAME='product_master_revisions' AND (
       NEW.product_master_id IS DISTINCT FROM OLD.product_master_id
    OR NEW.source_import_id IS DISTINCT FROM OLD.source_import_id
    OR NEW.source_import_row_id IS DISTINCT FROM OLD.source_import_row_id
    OR NEW.supersedes_revision_id IS DISTINCT FROM OLD.supersedes_revision_id
    OR NEW.revision_number IS DISTINCT FROM OLD.revision_number
    OR NEW.product_profile IS DISTINCT FROM OLD.product_profile
    OR NEW.category IS DISTINCT FROM OLD.category
    OR NEW.subcategory IS DISTINCT FROM OLD.subcategory
    OR NEW.revision_payload IS DISTINCT FROM OLD.revision_payload
    OR NEW.catalog_status IS DISTINCT FROM OLD.catalog_status
    OR NEW.effective_date IS DISTINCT FROM OLD.effective_date
    OR NEW.record_digest IS DISTINCT FROM OLD.record_digest
  ) THEN
    RAISE EXCEPTION 'product master revision payload is immutable';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_marketing_context_versions_payload_guard ON leadgen.marketing_context_versions;
CREATE TRIGGER trg_marketing_context_versions_payload_guard
    BEFORE UPDATE ON leadgen.marketing_context_versions
    FOR EACH ROW EXECUTE FUNCTION leadgen.protect_phase7_version_payload();
DROP TRIGGER IF EXISTS trg_product_master_revisions_payload_guard ON leadgen.product_master_revisions;
CREATE TRIGGER trg_product_master_revisions_payload_guard
    BEFORE UPDATE ON leadgen.product_master_revisions
    FOR EACH ROW EXECUTE FUNCTION leadgen.protect_phase7_version_payload();

CREATE OR REPLACE FUNCTION leadgen.enforce_phase7_import_commit()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.import_type IN ('PROSPECT_LEADS','PRODUCT_MASTER_UPDATE','CUSTOMER_DEALS','CUSTOMER_DEAL_LINES')
     AND NEW.status='COMMITTED' AND OLD.status IS DISTINCT FROM 'COMMITTED' THEN
    IF NOT NEW.dry_run_passed OR NEW.dry_run_digest IS NULL THEN
      RAISE EXCEPTION 'Phase 7 import requires a passed dry-run';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM leadgen.import_approvals a
      WHERE a.import_id=NEW.id AND a.decision='APPROVED'
        AND lower(a.dry_run_digest)=lower(NEW.dry_run_digest)
        AND lower(a.source_sha256)=lower(NEW.content_sha256)
    ) THEN
      RAISE EXCEPTION 'Phase 7 import requires exact dry-run and source-hash approval';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_reference_import_phase7_commit_guard ON leadgen.reference_data_imports;
CREATE TRIGGER trg_reference_import_phase7_commit_guard
    BEFORE UPDATE OF status ON leadgen.reference_data_imports
    FOR EACH ROW EXECUTE FUNCTION leadgen.enforce_phase7_import_commit();

COMMIT;
