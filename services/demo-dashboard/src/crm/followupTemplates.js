export const FOLLOWUP_TEMPLATE_SET='DPV_FOLLOWUP_V1';
// Days after the first touch for follow-up 2 and 3. Every draft still
// needs a person to approve it; these texts are proposals pending Simon's review.
export const FOLLOWUP_OFFSET_DAYS=Object.freeze({2:4,3:9});
export const MAX_FOLLOWUP_SEQUENCE=3;

const CATEGORY_LABELS=Object.freeze({WOMENSWEAR:'womenswear',GENERAL_MERCHANDISE:'general merchandise'});

export const FOLLOWUP_TEMPLATES=Object.freeze({
  2:Object.freeze({key:'FOLLOWUP_2_CHECK_IN',subject:'Following up: [Category] supply for [Company]',body_text:`Hello,

I wanted to follow up on my earlier email about [Category] supply for [Company].

If this category is relevant to your team, I can send a short catalogue for review.

Could you let me know whether this is of interest, or point me to the right person?

Best regards,
Simon
DPV International
[Reply-To]`}),
  3:Object.freeze({key:'FOLLOWUP_3_LAST_NOTE',subject:'[Category] catalogue for [Company]',body_text:`Hello,

This is my last note on [Category] supply for [Company].

If you are reviewing suppliers for this category now or later in the year, I would be glad to send a concise catalogue.

If this is not relevant, just reply and I will not follow up again.

Best regards,
Simon
DPV International
[Reply-To]`}),
});

export function followupCategoryLabel(productProfile){
  return CATEGORY_LABELS[String(productProfile||'').toUpperCase()]||'our product range';
}

export function renderFollowupTemplate({sequence_no,company_name,product_profile,reply_to}){
  const template=FOLLOWUP_TEMPLATES[Number(sequence_no)];
  if(!template)throw Object.assign(new Error('Follow-up sequence is not supported'),{code:'CRM_FOLLOWUP_SEQUENCE_INVALID',status:400});
  const company=String(company_name||'').trim();const replyTo=String(reply_to||'').trim();
  if(!company||!replyTo)throw Object.assign(new Error('Follow-up template variables are incomplete'),{code:'CRM_FOLLOWUP_VARIABLES_MISSING',status:409});
  const values={'[Company]':company,'[Category]':followupCategoryLabel(product_profile),'[Reply-To]':replyTo};
  const fill=text=>Object.entries(values).reduce((out,[token,value])=>out.split(token).join(value),text);
  const subject=fill(template.subject);const body_text=fill(template.body_text);
  // Keep the first character of a category label upper-case at the start of a subject.
  const normalizedSubject=subject.charAt(0).toUpperCase()+subject.slice(1);
  return{template_key:template.key,template_set_key:FOLLOWUP_TEMPLATE_SET,subject:normalizedSubject,body_text};
}
