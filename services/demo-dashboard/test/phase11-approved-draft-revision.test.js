import test from 'node:test';
import assert from 'node:assert/strict';
import {Phase7Repository} from '../src/phase7/repository.js';

function fixture({has_message=false,has_revision=false,status='APPROVED'}={}){
  const queries=[];
  const repository=new Phase7Repository({pool:{query:async()=>({rows:[]})}});
  repository.assertCurrentDraftGate=async()=>({id:'old'});
  repository.getDraft=async()=>({id:'old',version:1,draft_status:status,company_id:'company',
    eligibility_snapshot_id:'eligibility',recipient_id:'recipient',marketing_context_version:'context'});
  repository.transaction=async operation=>operation({query:async(sql,values)=>{
    queries.push({sql,values});
    if(sql.includes('has_message'))return{rows:[{has_message,has_revision}]};
    if(sql.includes('INSERT INTO leadgen.outreach_drafts'))return{rows:[{id:'new',version:2,draft_status:'PENDING_REVIEW'}]};
    return{rows:[]};
  }});
  return{repository,queries};
}

test('approved unsent draft creates a new reviewable version and keeps original payload intact',async()=>{
  const {repository,queries}=fixture();
  const result=await repository.reviseDraft('old',{draft_status:'PENDING_REVIEW',body_text:'Hello\n\nCategory introduction',followups:[],skill_versions:{}});
  assert.equal(result.version,2);
  assert.equal(result.draft_status,'PENDING_REVIEW');
  const update=queries.find(item=>item.sql.startsWith('UPDATE leadgen.outreach_drafts'));
  assert.match(update.sql,/draft_status='SUPERSEDED'/);
  assert.doesNotMatch(update.sql,/body_text|content_hash/);
  const insert=queries.find(item=>item.sql.includes('INSERT INTO leadgen.outreach_drafts'));
  assert.equal(insert.values[3],'old');
  assert.equal(insert.values[4],2);
});

test('any outbound record or existing revision prevents replacement before writes',async()=>{
  for(const state of [{has_message:true},{has_revision:true}]){
    const {repository,queries}=fixture(state);
    await assert.rejects(repository.reviseDraft('old',{}),error=>error.code==='DRAFT_REVISION_FORBIDDEN');
    assert.equal(queries.some(item=>/^(UPDATE|INSERT)/.test(item.sql)),false);
  }
});

test('rejected unsent draft can be revised while approval requires submission',async()=>{
  const {repository}=fixture({status:'REJECTED'});
  const revised=await repository.reviseDraft('old',{draft_status:'PENDING_REVIEW',followups:[],skill_versions:{}});
  assert.equal(revised.version,2);
  const pending=fixture({status:'PENDING_REVIEW'});
  await assert.rejects(pending.repository.createDraftApproval({draft_id:'old',decision:'APPROVED'}),error=>error.code==='DRAFT_SUBMISSION_REQUIRED');
  assert.equal(pending.queries.length,0);
});
