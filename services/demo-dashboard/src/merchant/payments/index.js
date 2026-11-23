// Merchant payments (migration 082). Today SIM records each payment by hand; recording one marks the
// merchant paid (ACTIVE) until the chosen day, never shortening an existing paid period.
// Online payment is prepared but not connected: a provider implements createCheckout() and
// verifyWebhook(); PAYMENT_PROVIDER selects it (unset = none, and the webhook route answers 404).
import {fail,merchantUuid} from '../MerchantService.js';

export const PAYMENT_METHODS=Object.freeze(['MANUAL','BANK','ALIPAY','WECHAT','STRIPE','OTHER']);
const DAY=86_400_000;

/**
 * Interface every online provider implements.
 *   createCheckout({merchant, amount, currency, paid_until}) -> {url, external_reference}
 *   verifyWebhook({headers, rawBody}) -> null (ignore) or
 *     {merchant_id, amount, currency, external_reference, paid_until, paid_at}
 */
export class PaymentProvider{
  constructor(name){this.name=name;}
  get connected(){return false;}
  async createCheckout(){throw fail('PAYMENT_PROVIDER_NOT_CONNECTED','Online payment is not connected yet',503);}
  async verifyWebhook(){throw fail('PAYMENT_PROVIDER_NOT_CONNECTED','Online payment is not connected yet',503);}
}
/** Placeholder for a chosen provider whose account is not set up yet. */
class NotConnectedProvider extends PaymentProvider{}

const PROVIDERS=Object.freeze({stripe:name=>new NotConnectedProvider(name),alipay:name=>new NotConnectedProvider(name)});
/** The configured provider, or null when PAYMENT_PROVIDER is unset or unknown. */
export function paymentProviderFrom(env=process.env){
  const name=String(env.PAYMENT_PROVIDER||'').trim().toLowerCase();
  return PROVIDERS[name]?PROVIDERS[name](name):null;
}

/** Validated payment fields; paid_until is a calendar day (end of that day, UTC) not in the past. */
export function paymentInput(body={},now=new Date()){
  const amount=Number(body.amount);
  if(!Number.isFinite(amount)||amount<=0||amount>=1e10)throw fail('PAYMENT_AMOUNT_INVALID','Amount must be a positive number',422,{field:'amount'});
  const currency=String(body.currency||'').trim().toUpperCase();
  if(!/^[A-Z]{3}$/.test(currency))throw fail('PAYMENT_CURRENCY_INVALID','Currency must be a 3-letter code such as CNY',422,{field:'currency'});
  const method=String(body.method||'MANUAL').trim().toUpperCase();
  if(!PAYMENT_METHODS.includes(method))throw fail('PAYMENT_METHOD_INVALID','Unsupported payment method',422,{field:'method'});
  const day=String(body.paid_until||'').slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||Number.isNaN(Date.parse(day)))throw fail('PAYMENT_PAID_UNTIL_INVALID','Choose the date the payment covers until',422,{field:'paid_until'});
  const paidUntil=new Date(`${day}T23:59:59.000Z`);
  if(paidUntil.getTime()<now.getTime()||paidUntil.getTime()>now.getTime()+5*366*DAY)
    throw fail('PAYMENT_PAID_UNTIL_INVALID','The covered date must be today or later, within five years',422,{field:'paid_until'});
  const text=(value,max,field)=>{const t=String(value??'').trim();if(!t)return null;if(t.length>max)throw fail('PAYMENT_TEXT_TOO_LONG',`${field} is too long`,422,{field});return t;};
  return{amount:Math.round(amount*100)/100,currency,method,paid_until:paidUntil.toISOString(),
    external_reference:text(body.external_reference,200,'external_reference'),note:text(body.note,500,'note')};
}

export class MerchantPaymentService{
  constructor({pool,now=()=>new Date()}){Object.assign(this,{pool,now});}

  /** Records the payment and marks the merchant paid in one transaction. */
  async record(merchantId,body={},actor,{provider='MANUAL'}={}){
    const id=merchantUuid(merchantId);
    const input=paymentInput(body,this.now());
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      const merchant=(await client.query('SELECT id,status,paid_until FROM leadgen.merchants WHERE id=$1 FOR UPDATE',[id])).rows[0];
      if(!merchant)throw fail('MERCHANT_NOT_FOUND','Merchant not found',404);
      if(input.external_reference&&(await client.query('SELECT 1 FROM leadgen.merchant_payments WHERE provider=$1 AND external_reference=$2',[provider,input.external_reference])).rowCount)
        throw fail('PAYMENT_DUPLICATE','This payment reference is already recorded',409,{field:'external_reference'});
      const payment=(await client.query(`INSERT INTO leadgen.merchant_payments(merchant_id,amount,currency,method,provider,external_reference,paid_until,note,recorded_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [id,input.amount,input.currency,input.method,provider,input.external_reference,input.paid_until,input.note,actor])).rows[0];
      // Same effect as "mark paid" on the merchants page (status ACTIVE, paid_until), never shortening a later date.
      const updated=(await client.query(`UPDATE leadgen.merchants SET status='ACTIVE',paid_until=greatest(coalesce(paid_until,$2::timestamptz),$2::timestamptz),updated_at=now()
        WHERE id=$1 RETURNING id,status,paid_until`,[id,input.paid_until])).rows[0];
      await client.query('COMMIT');
      return{payment:paymentView(payment),merchant:updated};
    }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
    finally{client.release();}
  }

  async list(merchantId){
    const id=merchantUuid(merchantId);
    const rows=(await this.pool.query('SELECT * FROM leadgen.merchant_payments WHERE merchant_id=$1 ORDER BY paid_at DESC,created_at DESC LIMIT 100',[id])).rows;
    return{items:rows.map(paymentView)};
  }
}
const paymentView=row=>({id:row.id,merchant_id:row.merchant_id,amount:Number(row.amount),currency:row.currency,method:row.method,provider:row.provider,
  external_reference:row.external_reference,paid_at:row.paid_at,paid_until:row.paid_until,note:row.note,recorded_by:row.recorded_by});
