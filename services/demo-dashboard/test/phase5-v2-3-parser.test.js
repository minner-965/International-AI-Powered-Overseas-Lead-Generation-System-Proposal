import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyCommercialPrice,
  mapCavannaPurchaseOrder,
  mapTf1Row,
  normalizeSharedProductProfile,
  parseContainerSequence,
  preserveOrderAndDeliveryDates,
  recognizeTf1Filename,
  resolveHistoricalCustomerAlias,
  sourceIdentity
} from '../src/referenceData/sharedHistoryParser.js';

test('TF1 family recognizes real naming variants and keeps container sequence out of entity ids', () => {
  assert.deepEqual(recognizeTf1Filename('(36th)TF1-PEDIDO SAMPLEBUYER(1).xlsx').container_sequence, 36);
  assert.equal(recognizeTf1Filename('(16th)F1-PRE PEDIDO SAMPLEBUYER.xlsx').is_pre_order, true);
  assert.equal(recognizeTf1Filename('(38th)TENT F1-PEDIDO SAMPLEBUYER.xlsx').record_type, 'TF1_PRODUCT_ORDER_PRICE');
  assert.equal(parseContainerSequence('37TH-YIWU'), 37);
  assert.equal(recognizeTf1Filename('customer-master.xlsx'), null);
});

test('TF1 row maps shipment facts without inventing customer or order identity', () => {
  const headers = ['Serial number','Product pictures','order volume','PC/SET','Product name','Product details','HS Code','color','Size','Individual packaging','outer carton dimensions','TOTAL CBM','Number of boxes','Total N.W.','Total G.W.','Factory price','Customer price (RMB)'];
  const row = [1,null,600,12,'Ice bucket','4L household ice bucket','732393','Blue','4L','bag','60x40x50',4.2,50,120,140,18,27];
  const mapped = mapTf1Row({ filename:'(36th)TF1-PEDIDO SAMPLEBUYER(1).xlsx',sourceHash:'a'.repeat(64),sourceSheet:'36TH',sourceRow:2,headers,row });
  assert.equal(mapped.container_sequence,36);
  assert.equal(mapped.external_customer_id,null);
  assert.equal(mapped.external_order_id,null);
  assert.equal(mapped.product_profile,'GENERAL_MERCHANDISE');
  assert.equal(mapped.supplier_price_type,'SUPPLIER_PRICE');
  assert.equal(mapped.customer_price_type,'CUSTOMER_SALES_PRICE');
  assert.equal(mapped.quantity,600);
});

test('ambiguous alias remains REVIEW and explicit MX client evidence confirms an alias', () => {
  assert.equal(resolveHistoricalCustomerAlias({ rawName:'Sample Buyer',marketCode:'',confidence:.9,evidence:[] }).resolution_status,'REVIEW');
  const confirmed = resolveHistoricalCustomerAlias({ rawName:'Sample Client',marketCode:'MX',confidence:.95,evidence:['EXPLICIT_CLIENT_LABEL','EXPLICIT_MARKET'] });
  assert.equal(confirmed.resolution_status,'CONFIRMED');
  assert.equal(confirmed.normalized_name,'sample client');
});

test('supplier prices and customer sales revenue stay distinct and USD FOB is explicit', () => {
  assert.deepEqual(classifyCommercialPrice('Factory price RMB'),{price_type:'SUPPLIER_PRICE',currency:'CNY',incoterm:null});
  assert.deepEqual(classifyCommercialPrice('USD FOB'),{price_type:'CUSTOMER_SALES_PRICE',currency:'USD',incoterm:'FOB'});
  assert.equal(classifyCommercialPrice('PRECIO VENTA').price_type,'DOWNSTREAM_RETAIL_PRICE');
});

test('delivery date never becomes order date', () => {
  assert.deepEqual(preserveOrderAndDeliveryDates({ orderDate:null,deliveryDate:'2026-06-30' }),{
    order_date:null,delivery_date:'2026-06-30',order_date_inferred_from_delivery:false
  });
});

test('product profile normalization uses textual source evidence only', () => {
  assert.equal(normalizeSharedProductProfile({sourcePath:'WOMENSWEAR/CLIENT PURCHASE ORDER',values:['dress']}),'WOMENSWEAR');
  assert.equal(normalizeSharedProductProfile({sourcePath:'2、义乌柜',values:['household ice bucket']}),'GENERAL_MERCHANDISE');
  assert.equal(normalizeSharedProductProfile({sourcePath:'images',values:['1234.jpg']}),'UNKNOWN');
});

test('CAVANNA purchase order maps explicit order date separately from delivery and preserves cancellation', () => {
  const mapped = mapCavannaPurchaseOrder({
    filename:'PO-SAMPLE-2026 SAMPLEBUYER-SAMPLECLIENT.xlsx',sourceHash:'b'.repeat(64),sourceSheet:'SAMPLE-CLIENT',
    labels:{market:'MEXICO',date:'2026-05-21',client:'Sample Client',po:'PO-SAMPLE-2026'},
    headers:['SELLER','BUYER','PO','STYLE REFERENCE','STYLE','DESCRIPTION','OC QUANTITY','USD FOB','DELIVERY DATE'],
    rows:[['SAMPLE SELLER','Sample Client','PO-SAMPLE-2026','R-1','DRESS-1','Women dress',100,8.5,'2026-07-01']]
  });
  assert.equal(mapped.customer_alias.resolution_status,'CONFIRMED');
  assert.equal(mapped.order.external_customer_id,'MX:sample client');
  assert.equal(mapped.order.order_date,'2026-05-21');
  assert.equal(mapped.lines[0].delivery_date,'2026-07-01');
  assert.equal(mapped.lines[0].incoterm,'FOB');
  assert.equal(mapped.lines[0].order_value,850);
  assert.notEqual(mapped.order.external_order_id,'36');
});

test('source identity changes with source hash and is stable for exact replay', () => {
  const one = sourceIdentity({sourceHash:'a'.repeat(64),sourceSheet:'Sheet1',sourceRow:2,rowKey:'SAMPLE CLIENT'});
  const replay = sourceIdentity({sourceHash:'a'.repeat(64),sourceSheet:'Sheet1',sourceRow:2,rowKey:'SAMPLE CLIENT'});
  const changed = sourceIdentity({sourceHash:'b'.repeat(64),sourceSheet:'Sheet1',sourceRow:2,rowKey:'SAMPLE CLIENT'});
  assert.equal(one,replay);
  assert.notEqual(one,changed);
});
