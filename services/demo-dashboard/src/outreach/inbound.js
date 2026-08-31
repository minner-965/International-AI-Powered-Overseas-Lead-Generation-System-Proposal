import { REPLY_INTENTS, unique, upper } from './constants.js';

const ENTITY_MAP = Object.freeze({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' });
const INTENT_PATTERNS = Object.freeze({
  AUTO_REPLY: /(automatic reply|auto[- ]?reply|out of (?:the )?office|away from (?:my )?email|respuesta autom[aá]tica|fuera de (?:la )?oficina)/i,
  OPT_OUT: /(unsubscribe|remove me|do not contact|stop emailing|opt out|darme de baja|eliminarme|no me contacte|no enviar m[aá]s)/i,
  DECLINE: /(not interested|no interest|we will pass|no estamos interesados|no nos interesa|rechazamos)/i,
  DEFER: /(contact me later|next (?:month|quarter|season)|reach out later|m[aá]s adelante|pr[oó]ximo (?:mes|trimestre)|cont[aá]cteme despu[eé]s)/i,
  QUOTATION: /(quotation|quote|pricing|price list|cotizaci[oó]n|precios?)/i,
  SAMPLE: /(sample|swatch|muestra|muestrario)/i,
  MEETING: /(meeting|schedule a call|book a call|video call|reuni[oó]n|agendar una llamada|videollamada)/i,
  CATALOGUE: /(catalog(?:ue)?|brochure|line sheet|cat[aá]logo|folleto)/i
});

export function sanitizeInboundText(value, maximum = 20_000) {
  let text = String(value ?? '');
  text = text
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(?:iframe|object|embed|form|input|button|svg|math)\b[^>]*>[\s\S]*?<\/(?:iframe|object|embed|form|button|svg|math)>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity) => {
      if (entity[0] === '#') {
        const hex = entity[1]?.toLowerCase() === 'x';
        const point = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
        return Number.isFinite(point) && point >= 32 ? String.fromCodePoint(point) : ' ';
      }
      return ENTITY_MAP[entity.toLowerCase()] ?? ' ';
    })
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, Math.max(0, Number(maximum) || 0));
}

/** Deterministic intent classification. It creates task instructions, never a send action. */
export function classifyInboundReply(input = {}) {
  const subject = sanitizeInboundText(input.subject, 500);
  const body = sanitizeInboundText(input.body_text || input.text || input.html, 20_000);
  const text = `${subject}\n${body}`;
  let intent = 'REVIEW';
  for (const candidate of ['OPT_OUT', 'AUTO_REPLY', 'DECLINE', 'DEFER', 'QUOTATION', 'SAMPLE', 'MEETING', 'CATALOGUE']) {
    if (INTENT_PATTERNS[candidate].test(text)) { intent = candidate; break; }
  }
  if (!text.trim()) intent = 'IRRELEVANT';
  if (!REPLY_INTENTS.includes(intent)) intent = 'REVIEW';
  const taskIntents = new Set(['CATALOGUE', 'SAMPLE', 'QUOTATION', 'MEETING', 'DEFER', 'REVIEW']);
  return {
    intent,
    confidence: intent === 'REVIEW' ? 0.35 : 0.9,
    confidence_basis: intent === 'REVIEW' ? 'LOW' : 'RULE_MATCH',
    sanitized_subject: subject,
    sanitized_body_text: body,
    actions: taskIntents.has(intent)
      ? [{ action: 'CREATE_SALES_TASK', requires_human_review: true }]
      : [],
    automatic_send_allowed: false,
    commercial_commitment_allowed: false
  };
}

function headerValues(headers, name) {
  const value = Object.entries(headers || {}).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
  return Array.isArray(value) ? value.map(String) : value ? [String(value)] : [];
}

export function correlateInboundReply(input = {}, lookup = {}) {
  const references = unique([
    ...headerValues(input.headers, 'in-reply-to'),
    ...headerValues(input.headers, 'references')
  ].flatMap(value => value.match(/<[^>]+>|[^\s,]+/g) || []).map(value => value.replace(/[<>]/g, '')));
  for (const reference of references) {
    const thread = lookup.by_provider_message_id?.[reference];
    if (thread) return { status: 'MATCHED', method: 'MESSAGE_HEADERS', thread_id: thread };
  }
  const token = String(input.reply_to_token || '').trim();
  if (token && lookup.by_reply_token?.[token]) return { status: 'MATCHED', method: 'REPLY_TO_TOKEN', thread_id: lookup.by_reply_token[token] };
  const sender = String(input.sender_email || input.from || '').trim().toLowerCase();
  if (sender && lookup.by_sender_email?.[sender]) return { status: 'MATCHED', method: 'SENDER_ACTIVE_THREAD', thread_id: lookup.by_sender_email[sender] };
  return { status: 'NEEDS_REVIEW', method: 'UNMATCHED', thread_id: null };
}

export function isolateAttachments(attachments = [], { maximumCount = 5, maximumBytes = 10_000_000 } = {}) {
  const accepted = [];
  const rejected = [];
  for (const [index, item] of (attachments || []).entries()) {
    const mime = String(item?.content_type || item?.mime_type || '').toLowerCase();
    const size = Number(item?.size_bytes || 0);
    const metadata = { attachment_id: String(item?.attachment_id || `attachment-${index + 1}`), content_type: mime, size_bytes: size };
    const executable = /(javascript|x-msdownload|x-executable|x-sh|x-bat|vnd\.microsoft\.portable-executable)/.test(mime);
    if (index >= maximumCount || size < 0 || size > maximumBytes || executable) rejected.push({ ...metadata, status: 'ISOLATED_REJECTED' });
    else accepted.push({ ...metadata, status: 'ISOLATED_PENDING_REVIEW' });
  }
  return { accepted, rejected };
}

const TASK_BLUEPRINTS = Object.freeze({
  CATALOGUE: {
    title: 'Share approved catalogue after review',
    next_action: 'Review the request and prepare an approved catalogue response.',
    due_hours: 24
  },
  SAMPLE: {
    title: 'Review sample request',
    next_action: 'Confirm sample feasibility and prepare a reviewed reply draft.',
    due_hours: 24
  },
  QUOTATION: {
    title: 'Review quotation request',
    next_action: 'Prepare a reviewed quotation handoff; do not send pricing automatically.',
    due_hours: 8
  },
  MEETING: {
    title: 'Review meeting request',
    next_action: 'Confirm owner, timing, and a reviewed reply draft before any commitment.',
    due_hours: 8
  },
  DEFER: {
    title: 'Track requested follow-up timing',
    next_action: 'Set the next action to the requested follow-up window after human review.',
    due_hours: 72
  },
  REVIEW: {
    title: 'Manual inbound review required',
    next_action: 'Review the sanitized inbound message and choose the next approved action.',
    due_hours: 4
  }
});

export function buildSalesTaskFromReply(input = {}, options = {}) {
  const classification = input.classification || classifyInboundReply(input);
  const blueprint = TASK_BLUEPRINTS[classification.intent];
  if (!blueprint) return { create_task: false, reason: 'NO_TASK_INTENT', task: null };
  const nowDate = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const dueDate = new Date(nowDate.getTime() + blueprint.due_hours * 3_600_000);
  const senderEmail = String(input.sender_email || input.from || '').trim().toLowerCase() || null;
  const threadId = input.thread_id || input.correlation?.thread_id || null;
  const subject = classification.sanitized_subject || sanitizeInboundText(input.subject, 200);
  const body = classification.sanitized_body_text || sanitizeInboundText(input.body_text || input.text || input.html, 400);
  const summary = body ? body.slice(0, 280) : subject || blueprint.title;
  return {
    create_task: true,
    task: {
      schema_version: 'outreach-sales-task-v1',
      intent: classification.intent,
      company_id: input.company_id || null,
      thread_id: threadId,
      recipient_email: senderEmail,
      owner_id: input.owner_id || null,
      source_message_id: input.provider_message_id || input.message_id || null,
      title: subject ? `${blueprint.title}: ${subject}`.slice(0, 160) : blueprint.title,
      summary,
      next_action: blueprint.next_action,
      status: 'OPEN',
      requires_human_review: true,
      automatic_send_allowed: false,
      commercial_commitment_allowed: false,
      due_at: dueDate.toISOString()
    }
  };
}
