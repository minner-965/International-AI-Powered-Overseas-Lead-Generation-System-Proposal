import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {Phase7Repository} from '../src/phase7/repository.js';
import {buildApprovalDigest} from '../src/outreach/approvalDigest.js';

test('actual worker readback reconstructs the identical approved snapshot without writes',{
  skip:process.env.PHASE11_LIVE_READBACK!=='1'
},async()=>{
  const pool=new pg.Pool({host:process.env.POSTGRES_HOST||'postgres',database:process.env.POSTGRES_DB,
    user:process.env.POSTGRES_USER,password:process.env.POSTGRES_PASSWORD});
  try{
    const row=(await pool.query('SELECT id FROM leadgen.outbound_messages ORDER BY queued_at DESC LIMIT 1')).rows[0];
    assert.ok(row,'An existing outbound record is required');
    const repository=new Phase7Repository({pool});
    const message=await repository.getOutboundMessage(row.id);
    const approval=await repository.getApprovalForEnqueue(message.approval_id);
    const snapshot=input=>buildApprovalDigest({...input,normalized_email:input.normalized_recipient,
      approved_claim_ids:(input.draft_product_claim_sets||[]).flat()});
    assert.deepEqual(snapshot(message).snapshot,snapshot(approval).snapshot);
    assert.equal(snapshot(message).approval_digest,approval.approval_digest);
  }finally{await pool.end();}
});
