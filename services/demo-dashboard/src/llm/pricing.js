// List prices per million tokens, from docs/plan/2026-10_LLM_EVALUATION.md section 6 (official pricing
// pages read 2026-10-26). Cost per call = list price x tokens; a model not listed here is recorded with
// an unknown cost (NULL), never 0 (evaluation guardrail 10). A local Ollama model costs nothing.
// Re-check the official pages before relying on these numbers; prices change.
const P=(currency,input,output)=>Object.freeze({currency,input,output});
export const PRICES=Object.freeze({
  'claude-haiku-5-5':P('USD',0.10,0.50),
  'claude-haiku-4-5':P('USD',1.00,5.00),
  'deepseek-flash':P('CNY',2,8),
  'deepseek-chat':P('CNY',2,8),
  'qwen-flash':P('USD',0.05,0.40),
  'qwen-plus':P('USD',0.40,1.20),
  'gpt-5-nano':P('USD',0.05,0.40),
  'gpt-5.4-nano':P('USD',0.20,1.25),
  'gpt-5-mini':P('USD',0.25,2.00)
});
// Claude Haiku 5.5 above 100k input tokens in one request.
const HAIKU_LONG=P('USD',0.50,2.50);

/** {amount, currency} or {amount:null, currency:null} when the price is not known. */
export function costOf({provider,model,inputTokens,outputTokens}){
  if(provider==='ollama')return{amount:0,currency:'USD'};
  if(inputTokens===null||inputTokens===undefined||outputTokens===null||outputTokens===undefined)return{amount:null,currency:null};
  const tokensIn=Number(inputTokens),tokensOut=Number(outputTokens);
  if(!Number.isFinite(tokensIn)||!Number.isFinite(tokensOut))return{amount:null,currency:null};
  const key=String(model||'').toLowerCase().replace(/^.*\//,'');
  let price=PRICES[key]||null;
  if(key==='claude-haiku-5-5'&&tokensIn>100_000)price=HAIKU_LONG;
  if(!price)return{amount:null,currency:null};
  return{amount:Math.round(((tokensIn*price.input+tokensOut*price.output)/1_000_000)*1e8)/1e8,currency:price.currency};
}
