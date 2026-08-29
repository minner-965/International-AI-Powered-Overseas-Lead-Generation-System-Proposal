import assert from 'node:assert/strict';
import test from 'node:test';
import { boundedObservedContacts } from '../src/enrichment/EnrichmentService.js';
import { extractProcurementPage } from '../src/enrichment/procurementExtractor.js';

const phone = (value,index) => ({
  contact_type:'PHONE',
  contact_value:value,
  normalized_value:value,
  source_url:`https://example.com/contact/${index}`,
  captured_at:new Date('2026-08-29T00:00:00Z')
});

test('official-site contact directories are bounded and prioritize the company market', () => {
  const contacts = [
    ...Array.from({ length:40 },(_,index)=>phone(`+1${String(8000000000+index)}`,index)),
    phone('+971501111111',41),phone('+971502222222',42),phone('+971503333333',43),phone('+971504444444',44),
    { contact_type:'WHATSAPP',contact_value:'https://wa.me/971501111111',normalized_value:'https://wa.me/971501111111',source_url:'https://example.com/contact' },
    { contact_type:'EMAIL',contact_value:'procurement@example.com',normalized_value:'procurement@example.com',source_url:'https://example.com/contact' },
    { contact_type:'CONTACT_FORM',contact_value:'https://example.com/contact',normalized_value:'https://example.com/contact',source_url:'https://example.com/contact' }
  ];
  const result = boundedObservedContacts([{ contacts }],{ country_code:'AE' });
  const phones = result.filter(item=>['BUSINESS_PHONE','BUSINESS_WHATSAPP'].includes(item.contact_type));
  assert.ok(result.length <= 12);
  assert.equal(phones.length,3);
  assert.equal(new Set(phones.map(item=>item.contact_value_normalized.replace(/\D/g,''))).size,3);
  assert.equal(phones.every(item=>item.contact_value_normalized.includes('971')),true);
  assert.equal(result.some(item=>item.contact_type === 'DEPARTMENT_EMAIL'),true);
  assert.equal(result.some(item=>item.contact_type === 'CONTACT_FORM'),true);
});

test('SEO headings and organization names never become named buyers', () => {
  const html = `<html><head><title>First-Time Stocklots Buyer Guide | Fair Trading International</title></head><body>
    <h1>Preguntas Frecuentes sobre Compras al Menudeo | AXÉ Online</h1>
    <p>Bismi Cold, our specialized division handles sourcing and delivery.</p>
    <p>Jane Smith — Senior Womenswear Buyer</p>
  </body></html>`;
  const result = extractProcurementPage(html,'https://example.com/team',{
    officialRootDomain:'example.com',productProfiles:['WOMENSWEAR'],capturedAt:new Date('2026-08-29T00:00:00Z')
  });
  assert.equal(result.decision_makers.length,1);
  assert.equal(result.decision_makers[0].person_name,'Jane Smith');
  assert.equal(result.decision_makers[0].normalized_role,'SENIOR_BUYER');
});
