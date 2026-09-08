import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeAutomationControl } from '../public/ui/v3/automation-model.js';

const read = path => fs.readFileSync(new URL(path, import.meta.url),'utf8');

test('MC07 automation control keeps enabled and disabled workflow capabilities distinct', () => {
  const model = normalizeAutomationControl({
    enabled:true,
    revision:4,
    features:{
      search_automation:true,
      opportunity_auto_pool:true,
      contact_research:true,
      auto_first_touch:true,
      inbound_reply_monitor:true,
      auto_follow_up:false,
      phone_automation:false,
      whatsapp_automation:false
    }
  },{
    selected_provider:'tavily',
    remaining_capacity:17,
    active_business_opportunities:6,
    contact_ready_count:4,
    email_eligible_count:2
  });
  assert.equal(model.enabled,true);
  assert.equal(model.features.search,true);
  assert.equal(model.features.firstTouch,true);
  assert.equal(model.features.followUp,false);
  assert.equal(model.features.phone,false);
  assert.equal(model.features.whatsapp,false);
  assert.equal(model.provider,'tavily');
  assert.deepEqual(model.metrics,{opportunities:6,contactReady:4,emailEligible:2,autoQueued:null,sentNoReply:null,replied:null});
});

test('MC07 UI uses persisted control APIs and preserves manual fallback', () => {
  const source=read('../public/ui/v3/automation-control.js');
  const outreach=read('../public/ui/outreach-workbench.js');
  assert.match(source,/request\('\/api\/automation\/control'\)/);
  assert.match(source,/request\('\/api\/automation\/status'\)/);
  assert.match(source,/method:'PUT'/);
  assert.match(source,/Switch to manual review/);
  assert.match(source,/Business Opportunity/);
  assert.match(source,/Contact Readiness/);
  assert.match(source,/Email Eligibility/);
  assert.match(outreach,/dpv:automationchange/);
  assert.match(outreach,/No verified email found/);
  assert.match(outreach,/Continue contact research/);
  assert.match(outreach,/row\.message_id\|\|contactProgressStatus\(row\)/);
});

test('MC07 UI normalizes the persisted automation facade response', () => {
  const model=normalizeAutomationControl({
    automated_acquisition:true,
    search_automation:true,
    opportunity_auto_pool:true,
    contact_research_automation:true,
    auto_first_touch_email:true,
    inbound_reply_monitor:true,
    auto_email_followup_sequence:false,
    phone_whatsapp_automation:false,
    policy_revision:'MC07_DPV_FIRST_TOUCH_V1',
    provider_order:['tavily']
  },{
    state:{automated_acquisition:true},
    provider:{status:'AVAILABLE',remaining_credits:9},
    subsystems:{search:{status:'HEALTHY'}}
  });
  assert.equal(model.enabled,true);
  assert.equal(model.features.contactResearch,true);
  assert.equal(model.features.firstTouch,true);
  assert.equal(model.features.followUp,false);
  assert.equal(model.provider,'tavily');
  assert.equal(model.capacity,9);
  assert.equal(model.paused,false);
});

test('MC07 automation UI remains in the V3 family and has compact mobile rules', () => {
  const html=read('../public/index.html');
  const css=read('../public/ui/v3/automation-control.css');
  assert.match(html,/ui\/v3\/automation-control\.css/);
  assert.match(css,/var\(--dpv-surface\)/);
  assert.match(css,/@media\(max-width:600px\)/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
  assert.doesNotMatch(css,/gradient|glow|shimmer/i);
});
