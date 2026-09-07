import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {Phase7Repository} from '../src/phase7/repository.js';
import {stableSmtpMessageId,stableSmtpMessageKey} from '../src/outreach/index.js';

test('current PostgreSQL outbound schema accepts stable execution identity and replay, rolling back every row',{
  skip:process.env.PHASE11_LIVE_SCHEMA_ROLLBACK!=='1'
},async()=>{
  const pool=new pg.Pool({host:process.env.POSTGRES_HOST||'postgres',database:process.env.POSTGRES_DB,
    user:process.env.POSTGRES_USER,password:process.env.POSTGRES_PASSWORD});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const baseline=(await client.query('SELECT count(*)::int n FROM leadgen.outbound_messages')).rows[0].n;
    const approval=(await client.query(`SELECT a.id,a.company_id,a.recipient_id FROM leadgen.outreach_approvals a
      JOIN leadgen.outreach_drafts d ON d.id=a.draft_id WHERE a.decision='APPROVED' AND d.draft_status='APPROVED'
      AND NOT EXISTS(SELECT 1 FROM leadgen.outbound_messages m WHERE m.approval_id=a.id)
      ORDER BY a.approved_at DESC LIMIT 1 FOR UPDATE OF a`)).rows[0];
    assert.ok(approval,'An approved unsent draft is required for the rollback schema check');
    const key=`rollback-schema-${randomUUID()}`;
    const input={company_id:approval.company_id,recipient_id:approval.recipient_id,approval_id:approval.id,
      provider:'SMTP',provider_purpose:'COLD_OUTREACH',idempotency_key:key,send_status:'QUEUED',reason_codes:[],
      message_key_header:stableSmtpMessageKey(key),rfc_message_id:stableSmtpMessageId(key,'fixture.invalid')};
    const repository=new Phase7Repository({pool:client});
    const first=await repository.createOutboundMessage(input);
    const replay=await repository.createOutboundMessage(input);
    assert.equal(first.send_execution_key,key);
    assert.equal(first.rfc_message_id,input.rfc_message_id);
    assert.equal(replay.id,first.id);
    assert.equal((await client.query('SELECT count(*)::int n FROM leadgen.outbound_message_attempts WHERE outbound_message_id=$1',[first.id])).rows[0].n,0);
    await client.query('ROLLBACK');
    assert.equal((await client.query('SELECT count(*)::int n FROM leadgen.outbound_messages')).rows[0].n,baseline);
  }finally{
    await client.query('ROLLBACK').catch(()=>{});
    client.release();await pool.end();
  }
});
