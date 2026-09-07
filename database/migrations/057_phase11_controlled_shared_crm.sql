BEGIN;

-- Reuse application CRM entities without creating a prospect company for a controlled mailbox.
ALTER TABLE leadgen.controlled_application_inbound_messages ADD CONSTRAINT controlled_inbound_context_identity UNIQUE(id,context_id);

ALTER TABLE leadgen.crm_sync_outbox
  ALTER COLUMN company_id DROP NOT NULL,
  ADD COLUMN record_scope text NOT NULL DEFAULT 'PROSPECT',
  ADD COLUMN controlled_context_id uuid REFERENCES leadgen.controlled_application_contexts(id) ON DELETE RESTRICT,
  ADD COLUMN controlled_inbound_message_id uuid,
  ADD CONSTRAINT crm_outbox_controlled_inbound_fk FOREIGN KEY(controlled_inbound_message_id,controlled_context_id)
    REFERENCES leadgen.controlled_application_inbound_messages(id,context_id) ON DELETE RESTRICT,
  ADD CONSTRAINT crm_outbox_scope_check CHECK(
    (record_scope='PROSPECT' AND company_id IS NOT NULL AND controlled_context_id IS NULL AND controlled_inbound_message_id IS NULL) OR
    (record_scope='CONTROLLED' AND company_id IS NULL AND controlled_context_id IS NOT NULL AND controlled_inbound_message_id IS NOT NULL AND task_id IS NULL AND operation='UPDATE_ACTIVITY'));

ALTER TABLE leadgen.opportunity_activities
  ALTER COLUMN company_id DROP NOT NULL,
  ADD COLUMN record_scope text NOT NULL DEFAULT 'PROSPECT',
  ADD COLUMN controlled_context_id uuid REFERENCES leadgen.controlled_application_contexts(id) ON DELETE RESTRICT,
  ADD COLUMN controlled_inbound_message_id uuid,
  ADD CONSTRAINT crm_activity_controlled_inbound_fk FOREIGN KEY(controlled_inbound_message_id,controlled_context_id)
    REFERENCES leadgen.controlled_application_inbound_messages(id,context_id) ON DELETE RESTRICT,
  ADD CONSTRAINT crm_activity_scope_check CHECK(
    (record_scope='PROSPECT' AND company_id IS NOT NULL AND controlled_context_id IS NULL AND controlled_inbound_message_id IS NULL) OR
    (record_scope='CONTROLLED' AND company_id IS NULL AND controlled_context_id IS NOT NULL AND controlled_inbound_message_id IS NOT NULL AND opportunity_snapshot_id IS NULL AND inbound_message_id IS NULL AND classification_id IS NULL));

ALTER TABLE leadgen.sales_tasks
  ALTER COLUMN company_id DROP NOT NULL,
  ADD COLUMN record_scope text NOT NULL DEFAULT 'PROSPECT',
  ADD COLUMN controlled_context_id uuid REFERENCES leadgen.controlled_application_contexts(id) ON DELETE RESTRICT,
  ADD COLUMN controlled_inbound_message_id uuid,
  ADD CONSTRAINT crm_task_controlled_inbound_fk FOREIGN KEY(controlled_inbound_message_id,controlled_context_id)
    REFERENCES leadgen.controlled_application_inbound_messages(id,context_id) ON DELETE RESTRICT,
  ADD CONSTRAINT crm_task_scope_check CHECK(
    (record_scope='PROSPECT' AND company_id IS NOT NULL AND controlled_context_id IS NULL AND controlled_inbound_message_id IS NULL) OR
    (record_scope='CONTROLLED' AND company_id IS NULL AND controlled_context_id IS NOT NULL AND controlled_inbound_message_id IS NOT NULL AND opportunity_snapshot_id IS NULL AND inbound_message_id IS NULL AND classification_id IS NULL AND thread_id IS NULL));

CREATE INDEX idx_crm_outbox_controlled_context ON leadgen.crm_sync_outbox(controlled_context_id,created_at) WHERE record_scope='CONTROLLED';
CREATE INDEX idx_crm_activity_controlled_context ON leadgen.opportunity_activities(controlled_context_id,created_at) WHERE record_scope='CONTROLLED';
CREATE INDEX idx_crm_task_controlled_context ON leadgen.sales_tasks(controlled_context_id,created_at) WHERE record_scope='CONTROLLED';
COMMIT;
