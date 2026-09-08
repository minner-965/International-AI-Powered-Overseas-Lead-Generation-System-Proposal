import test from 'node:test';
import assert from 'node:assert/strict';
import {AutomationControlService,AUTOMATION_CONTROLS} from '../src/automation/AutomationControlService.js';

function fixture({enabled=false,replay=null}={}){
  const calls=[];
  const control={control_key:AUTOMATION_CONTROLS.RESEARCH_PROVIDER_EXECUTION,enabled,revision:1,settings:{}};
  const client={release(){calls.push(['release']);},async query(sql,args=[]){calls.push([sql,args]);
    if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return{rows:[],rowCount:0};
    if(sql.includes('automation_control_events WHERE idempotency_key'))return replay?{rows:[replay],rowCount:1}:{rows:[],rowCount:0};
    if(sql.includes('automation_controls WHERE control_key')&&sql.includes('FOR UPDATE'))return{rows:[control],rowCount:1};
    if(sql.includes('INSERT INTO leadgen.automation_control_events'))return{rows:[{control_key:args[0],revision:args[1],previous_enabled:args[2],enabled:args[3],settings_snapshot:JSON.parse(args[4]),actor:args[5],change_reason:args[6],idempotency_key:args[7]}],rowCount:1};
    if(sql.includes('UPDATE leadgen.automation_controls'))return{rows:[],rowCount:1};
    return{rows:[control],rowCount:1};
  }};
  return{calls,client,pool:{connect:async()=>client,query:(...args)=>client.query(...args)}};
}

test('automation controls fail closed and expose no secret-bearing fallback',async()=>{
  const f=fixture();const service=new AutomationControlService({pool:f.pool});
  assert.equal(await service.isEnabled(AUTOMATION_CONTROLS.RESEARCH_PROVIDER_EXECUTION),false);
  await assert.rejects(service.requireEnabled(AUTOMATION_CONTROLS.RESEARCH_PROVIDER_EXECUTION),{code:'AUTOMATION_CONTROL_DISABLED',status:503});
});

test('control mutation and immutable audit event share one transaction',async()=>{
  const f=fixture();const service=new AutomationControlService({pool:f.pool});
  const result=await service.set({controlKey:'research_provider_execution',enabled:true,settings:{sample_size:4},
    actor:'operator',reason:'controlled smoke',idempotencyKey:'mc07:enable:1'});
  assert.equal(result.revision,2);assert.equal(result.previous_enabled,false);assert.equal(result.enabled,true);
  const sql=f.calls.map(([value])=>value);
  assert.ok(sql.indexOf('BEGIN')<sql.findIndex(value=>value.includes('INSERT INTO leadgen.automation_control_events')));
  assert.ok(sql.findIndex(value=>value.includes('INSERT INTO leadgen.automation_control_events'))<sql.findIndex(value=>value.includes('UPDATE leadgen.automation_controls')));
  assert.equal(sql.at(-2),'COMMIT');assert.deepEqual(f.calls.at(-1),['release']);
});

test('idempotent control replay never updates the current control twice',async()=>{
  const prior={control_key:'RESEARCH_PROVIDER_EXECUTION',revision:2,enabled:true,actor:'operator',settings_snapshot:{sample_size:4}};
  const f=fixture({replay:prior});const service=new AutomationControlService({pool:f.pool});
  const result=await service.set({controlKey:'RESEARCH_PROVIDER_EXECUTION',enabled:true,settings:{sample_size:4},
    actor:'operator',reason:'ignored on exact replay',idempotencyKey:'mc07:enable:1'});
  assert.equal(result.idempotent_replay,true);
  assert.equal(f.calls.some(([sql])=>sql.includes?.('UPDATE leadgen.automation_controls')),false);
});

test('control replay conflict and invalid audit context are rejected before mutation',async()=>{
  const prior={control_key:'RESEARCH_PROVIDER_EXECUTION',revision:2,enabled:false,actor:'operator',settings_snapshot:{}};
  const f=fixture({replay:prior});const service=new AutomationControlService({pool:f.pool});
  await assert.rejects(service.set({controlKey:'RESEARCH_PROVIDER_EXECUTION',enabled:true,actor:'operator',reason:'x',idempotencyKey:'same'}),{code:'AUTOMATION_CONTROL_IDEMPOTENCY_CONFLICT'});
  await assert.rejects(service.set({controlKey:'RESEARCH_PROVIDER_EXECUTION',enabled:true}),{code:'AUTOMATION_CONTROL_AUDIT_CONTEXT_REQUIRED'});
});
