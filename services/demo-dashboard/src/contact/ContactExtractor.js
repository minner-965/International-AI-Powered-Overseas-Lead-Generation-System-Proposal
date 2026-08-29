import { htmlService } from '../platform/HtmlService.js';
import { isValidEmailSyntax, verifyObservedEmail } from './emailVerifier.js';
import { normalizePhone, normalizePhoneWithContext, normalizeWhatsApp } from './phoneUtils.js';

const emailRegex = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/gi;
const falseEmail = /^(?:example|test|user|name|email|yourname)@|\.(?:png|jpe?g|gif|svg|webp)$/i;

function cleanObserved(value) {
  return String(value || '').replace(/^mailto:/i, '').split('?')[0]
    .replace(/^[\s<({["']+|[\s>)}\]"',;:.]+$/g, '').trim();
}

function pageTitle($) {
  return $('title').first().text().replace(/\s+/g, ' ').trim().slice(0, 1000) || null;
}

function visibleText($) {
  $('script,style,noscript,template,svg').remove();
  $('body').find('*').each((_i, node) => $(node).append(' '));
  return $('body').text().replace(/\s+/g, ' ').trim();
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  return items.filter(item => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function visiblePhoneValues(text, marketProfile) {
  const values = [];
  const internationalValues = [];
  const labeled = /(?:phone|telephone|tel\.?|mobile|call|contact|电话|手机|联系电话)\s*[:：-]?\s*((?:\+|00)?\d[\d\s().-]{5,}\d)/gi;
  const international = /(?:\+|00)\d[\d\s().-]{6,}\d/g;
  let match;
  while ((match = labeled.exec(text))) values.push(match[1].trim());
  while ((match = international.exec(text))) {
    const context = text.slice(Math.max(0, match.index - 18), match.index).toLowerCase();
    if (!/fax\s*[:：-]?\s*$/.test(context)) internationalValues.push(match[0].trim());
  }
  const uniqueInternational = uniqueBy(internationalValues.map(value => ({
    value,
    normalized: normalizePhone(value, marketProfile)
  })).filter(item => item.normalized), item => item.normalized);
  if (uniqueInternational.length <= 5) values.push(...uniqueInternational.map(item => item.value));
  return values.filter(value => !/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(value));
}

function likelyContactForm($, sourceUrl) {
  const form = $('form').filter((_i, node) => {
    const element = $(node);
    const signal = `${element.attr('action') || ''} ${element.attr('id') || ''} ${element.attr('class') || ''} ${element.text()}`;
    const hasMessage = element.find('textarea,input[name*=message i],input[name*=enquiry i],input[name*=inquiry i]').length > 0;
    const hasSubmit = element.find('button[type=submit],input[type=submit],button').length > 0;
    return hasSubmit && (hasMessage || /contact|enquir|send message|business enquiry/i.test(signal));
  }).first();
  return form.length ? sourceUrl : null;
}

function valuesFromStructuredBusinessData(items) {
  const emails = [];
  const phones = [];
  const businessType = /organization|corporation|localbusiness|store|professionalservice/i;
  for (const item of items) {
    const types = Array.isArray(item?.['@type']) ? item['@type'] : [item?.['@type']];
    if (!types.some(type => businessType.test(String(type || '')))) continue;
    if (item.email) emails.push(cleanObserved(item.email));
    if (item.telephone) phones.push(cleanObserved(String(item.telephone).replace(/^tel:/i, '')));
    const points = Array.isArray(item.contactPoint) ? item.contactPoint : item.contactPoint ? [item.contactPoint] : [];
    for (const point of points) {
      if (point?.email) emails.push(cleanObserved(point.email));
      if (point?.telephone) phones.push(cleanObserved(String(point.telephone).replace(/^tel:/i, '')));
    }
  }
  return { emails, phones };
}

export async function extractPublicContacts(html, sourceUrl, options = {}) {
  const $ = htmlService.load(html);
  const title = pageTitle($);
  const structured = valuesFromStructuredBusinessData(htmlService.jsonLdItems($));
  const text = visibleText($);
  const capturedAt = options.capturedAt || new Date();
  const marketProfile = options.marketProfile || { phoneCountryCode: options.phoneCountryCode || null };
  const phoneCountryContext = marketProfile.phoneCountryCode || null;
  const base = { source_url: sourceUrl, source_page_title: title, captured_at: capturedAt };

  const emailValues = [
    ...$('a[href^="mailto:" i]').map((_i, node) => cleanObserved($(node).attr('href'))).get(),
    ...structured.emails,
    ...(text.match(emailRegex) || []).map(cleanObserved)
  ].filter(value => isValidEmailSyntax(value) && !falseEmail.test(value));
  const contacts = [];
  for (const email of uniqueBy(emailValues.map(raw => ({ raw, normalized: raw.toLowerCase() })), value => value.normalized)) {
    const verification = await verifyObservedEmail(email.normalized, options);
    contacts.push({
      ...base, contact_type: 'EMAIL', contact_value: email.raw, normalized_value: email.normalized,
      ...verification
    });
  }

  const telValues = [
    ...$('a[href^="tel:" i]').map((_i, node) => cleanObserved($(node).attr('href').replace(/^tel:/i, ''))).get(),
    ...structured.phones,
    ...visiblePhoneValues(text, marketProfile)
  ];
  for (const value of uniqueBy(telValues.map(value => ({
    value,
    ...normalizePhoneWithContext(value, marketProfile)
  })).filter(item => item.normalized_value), item => item.normalized_value)) {
    contacts.push({
      ...base, contact_type: 'PHONE', contact_value: value.value, normalized_value: value.normalized_value,
      phone_country_context: phoneCountryContext,
      normalization_status: value.normalization_status,
      verification_status: 'PUBLICLY_OBSERVED', verification_method: 'public_page+phone_format',
      syntax_valid: null, mx_present: null
    });
  }

  const whatsappLinks = $('a[href]').map((_i, node) => $(node).attr('href')).get()
    .filter(href => /^(?:https?:\/\/(?:www\.)?(?:wa\.me|api\.whatsapp\.com|web\.whatsapp\.com)\/|whatsapp:\/\/)/i.test(href));
  for (const href of uniqueBy(whatsappLinks.map(value => ({ value, normalized: normalizeWhatsApp(value, marketProfile) })).filter(item => item.normalized), item => item.normalized)) {
    contacts.push({
      ...base, contact_type: 'WHATSAPP', contact_value: href.value, normalized_value: href.normalized,
      phone_country_context: phoneCountryContext,
      normalization_status: 'EXPLICIT_INTERNATIONAL',
      verification_status: 'PUBLICLY_OBSERVED', verification_method: 'explicit_whatsapp_link',
      syntax_valid: null, mx_present: null
    });
  }

  const formUrl = likelyContactForm($, sourceUrl);
  if (formUrl) contacts.push({
    ...base, contact_type: 'CONTACT_FORM', contact_value: formUrl, normalized_value: formUrl,
    verification_status: 'PUBLICLY_OBSERVED', verification_method: 'public_contact_form',
    phone_country_context: null, normalization_status: 'NOT_APPLICABLE',
    syntax_valid: null, mx_present: null
  });

  return { title, contacts: uniqueBy(contacts, item => `${item.contact_type}|${item.normalized_value}`) };
}
