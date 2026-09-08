const first = (source, keys, fallback = undefined) => {
  const key = keys.find(candidate => source?.[candidate] !== undefined);
  return key === undefined ? fallback : source[key];
};
const bool = value => value === true || ['ON','ENABLED','ACTIVE','AUTO','TRUE','1'].includes(String(value ?? '').toUpperCase());

export function normalizeAutomationControl(payload = {}, statusPayload = {}) {
  const source = payload.state || payload.control || payload.automation || payload;
  const features = source.features || source.controls || source.capabilities || {};
  const nestedStatus = statusPayload.state || statusPayload.status || statusPayload.automation || {};
  const status = { ...statusPayload, ...nestedStatus };
  const provider = statusPayload.provider || status.provider || {};
  const subsystems = statusPayload.subsystems || status.subsystems || {};
  const enabled = bool(first(source, ['enabled','master_enabled','automation_enabled','acquisition_enabled','automated_acquisition'], first(source, ['mode','master_status'], false)));
  const feature = (keys, fallback) => bool(first(features, keys, first(source, keys, fallback)));
  return {
    enabled,
    revision: first(source, ['revision','policy_revision','version'], '—'),
    updatedAt: first(source, ['updated_at','changed_at'], ''),
    features: {
      search: feature(['search','search_automation','search_enabled'], enabled),
      opportunity: feature(['opportunity','opportunity_pool','opportunity_auto_pool'], enabled),
      contactResearch: feature(['contact_research','contact_enrichment','contact_research_automation'], enabled),
      firstTouch: feature(['auto_first_touch','first_touch_email','auto_email','auto_first_touch_email'], enabled),
      replies: feature(['inbound_reply_monitor','reply_monitor','imap_monitor'], enabled),
      followUp: feature(['auto_follow_up','follow_up_email','auto_email_followup_sequence'], false),
      phone: feature(['phone_automation','auto_phone','phone_whatsapp_automation'], false),
      whatsapp: feature(['whatsapp_automation','auto_whatsapp','phone_whatsapp_automation'], false)
    },
    provider: first(provider, ['selected_provider','provider','name','key'], first(status, ['selected_provider','search_provider'], first(source, ['selected_provider','provider'], source.provider_order?.[0] || '—'))),
    providerReason: first(provider, ['provider_selection_reason','selection_reason','reason'], first(status, ['provider_selection_reason','selection_reason'], '')),
    capacity: first(provider, ['remaining_capacity','remaining_credits','provider_capacity'], first(status, ['remaining_capacity','remaining_credits','provider_capacity'], null)),
    paused: bool(first(status, ['paused','capacity_paused'], false)) || ['PAUSED','DEGRADED'].includes(String(subsystems.search?.status || '').toUpperCase()),
    pauseReason: first(status, ['pause_reason','paused_reason','block_reason'], first(subsystems.search || {}, ['reason','code'], '')),
    metrics: {
      opportunities: first(status, ['active_business_opportunities','active_opportunities','opportunity_count'], null),
      contactReady: first(status, ['contact_ready','contact_ready_count'], null),
      emailEligible: first(status, ['email_eligible','email_eligible_count'], null),
      autoQueued: first(status, ['auto_first_touch_queued','first_touch_queued','queued_count'], null),
      sentNoReply: first(status, ['sent_no_reply','first_touch_sent','sent_count'], null),
      replied: first(status, ['replied','reply_count'], null)
    }
  };
}
