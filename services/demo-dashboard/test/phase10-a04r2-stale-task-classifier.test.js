import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyStaleTaskSnapshot,STALE_TASK_CLASSIFICATIONS} from '../../../scripts/classify-stale-auto-evidence-tasks.mjs';

const base={lease_expired:true,current_stage:'DISCOVERING_SOURCES',current_strategy_code:'S05_OFFICIAL_PRESS_PDF',
  provider_usage_event_count:0,provider_used_units:0,provider_request_id_count:0,business_output_count:0,
  checkpoint_event_count:1,current_started_count:0,current_settled_count:0,live_queue_count:0,pending_outbox_count:0,
  active_canonical_continuation_count:0,cross_task_reference_count:0,canonical_terminal:false};

test('R2 classifier exposes only the seven plan classifications',()=>{
  assert.deepEqual(STALE_TASK_CLASSIFICATIONS,[
    'HEALTHY_ACTIVE','STALE_EMPTY_PURGE_ELIGIBLE','STALE_WITH_PROVIDER_USAGE_ARCHIVE',
    'STALE_WITH_BUSINESS_OUTPUT_FINALIZE','STALE_RECOVERABLE_CONTINUATION',
    'ALREADY_TERMINAL_PROJECTION_DRIFT','AMBIGUOUS_BLOCKED'
  ]);
});

test('R2 classifier prioritizes a unique unfinished checkpoint over preserved outputs',()=>{
  assert.equal(classifyStaleTaskSnapshot({...base,business_output_count:8,provider_used_units:2}),
    'STALE_RECOVERABLE_CONTINUATION');
});

test('R2 classifier distinguishes active, terminal drift, output, provider and empty cases',()=>{
  assert.equal(classifyStaleTaskSnapshot({...base,live_queue_count:1}),'HEALTHY_ACTIVE');
  assert.equal(classifyStaleTaskSnapshot({...base,canonical_terminal:true,current_settled_count:1}),
    'ALREADY_TERMINAL_PROJECTION_DRIFT');
  assert.equal(classifyStaleTaskSnapshot({...base,current_stage:null,current_strategy_code:null,business_output_count:1}),
    'STALE_WITH_BUSINESS_OUTPUT_FINALIZE');
  assert.equal(classifyStaleTaskSnapshot({...base,current_stage:null,current_strategy_code:null,provider_used_units:1}),
    'STALE_WITH_PROVIDER_USAGE_ARCHIVE');
  assert.equal(classifyStaleTaskSnapshot({...base,current_stage:null,current_strategy_code:null,checkpoint_event_count:0}),
    'STALE_EMPTY_PURGE_ELIGIBLE');
});

test('R2 classifier blocks ambiguous ownership and duplicate active continuations',()=>{
  assert.equal(classifyStaleTaskSnapshot({...base,cross_task_reference_count:1}),'AMBIGUOUS_BLOCKED');
  assert.equal(classifyStaleTaskSnapshot({...base,active_canonical_continuation_count:2}),'AMBIGUOUS_BLOCKED');
});
