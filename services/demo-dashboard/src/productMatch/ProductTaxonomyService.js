import crypto from 'node:crypto';
import { classifyProductMaster,flattenTaxonomyNodes,getProductTaxonomyAliases,PRODUCT_TAXONOMY_VERSION } from './productTaxonomy.js';

export const PRODUCT_CLASSIFICATION_VERSION='product-taxonomy-classifier-v1';
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

export class ProductTaxonomyService{
  constructor({pool}={}){if(!pool)throw new Error('ProductTaxonomyService requires a PostgreSQL pool');this.pool=pool;}

  async syncTaxonomy(client){
    const nodeIds=new Map();
    for(const node of flattenTaxonomyNodes()){
      const parentId=node.parent_code?nodeIds.get(node.parent_code):null;
      await client.query(`INSERT INTO leadgen.product_taxonomy_nodes
        (taxonomy_version,product_profile,node_type,canonical_code,canonical_name,parent_id,attribute_set)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(taxonomy_version,canonical_code) DO NOTHING`,
      [PRODUCT_TAXONOMY_VERSION,node.product_profile,node.node_type,node.canonical_code,node.canonical_name,parentId,node.attribute_set]);
      const saved=await client.query('SELECT id FROM leadgen.product_taxonomy_nodes WHERE taxonomy_version=$1 AND canonical_code=$2',[PRODUCT_TAXONOMY_VERSION,node.canonical_code]);
      nodeIds.set(node.canonical_code,saved.rows[0].id);
    }
    let aliasCount=0;
    for(const alias of getProductTaxonomyAliases()){
      const target=alias.subcategory||alias.category||alias.profile;
      const nodeId=nodeIds.get(target);
      if(!nodeId)continue;
      const inserted=await client.query(`INSERT INTO leadgen.product_taxonomy_aliases
        (taxonomy_node_id,taxonomy_version,language,market_code,raw_alias,normalized_alias,alias_match_type,status)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT DO NOTHING RETURNING id`,[nodeId,PRODUCT_TAXONOMY_VERSION,alias.language,alias.market_code||null,alias.alias,alias.normalized_alias,alias.match_type,alias.match_type==='AMBIGUOUS'?'REVIEW':'ACTIVE']);
      aliasCount+=inserted.rowCount;
    }
    return {nodeIds,aliasCount};
  }

  assignmentFor(product){
    const classification=classifyProductMaster(product);
    const catalogStatus=product.confirmed_order_supported?'HISTORICAL_ORDER_SUPPORTED'
      :['CONFIRMED','SUPPORTED'].includes(classification.assignment_status)?'REFERENCE_ONLY'
        :classification.assignment_status==='REVIEW'?'REVIEW':'UNKNOWN';
    return {...classification,catalog_status:catalogStatus,input_digest:digest({
      id:product.id,product_profile:product.product_profile,product_name:product.product_name,category:product.category,
      material:product.material,size_spec:product.size_spec,color:product.color,packing:product.packing,
      confirmed_order_supported:Boolean(product.confirmed_order_supported)
    })};
  }

  async classifyAll({apply=false}={}){
    const {rows}=await this.pool.query(`SELECT pm.id,pm.product_profile,pm.product_name,pm.category,pm.material,pm.size_spec,pm.color,pm.packing,
      EXISTS(SELECT 1 FROM leadgen.historical_order_lines hol JOIN leadgen.historical_orders ho ON ho.id=hol.historical_order_id
        WHERE hol.product_id=pm.id AND ho.order_status='CONFIRMED') AS confirmed_order_supported
      FROM leadgen.product_master pm ORDER BY pm.id`);
    const assignments=rows.map(row=>({product:row,assignment:this.assignmentFor(row)}));
    const counts=Object.fromEntries(['CONFIRMED','SUPPORTED','REVIEW','UNKNOWN'].map(status=>[status,assignments.filter(item=>item.assignment.assignment_status===status).length]));
    if(!apply)return {taxonomy_version:PRODUCT_TAXONOMY_VERSION,classification_version:PRODUCT_CLASSIFICATION_VERSION,products:rows.length,assignments:counts,status:'DRY_RUN'};
    const client=await this.pool.connect();
    let inserted=0;
    try{
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`product-taxonomy:${PRODUCT_TAXONOMY_VERSION}`]);
      const {nodeIds,aliasCount}=await this.syncTaxonomy(client);
      for(const {product,assignment} of assignments){
        const nodeCode=assignment.normalized_subcategory||assignment.normalized_category||null;
        const nodeId=nodeCode?nodeIds.get(nodeCode)||null:null;
        const result=await client.query(`INSERT INTO leadgen.product_master_taxonomy_assignments
          (product_master_id,taxonomy_node_id,taxonomy_version,normalized_profile,normalized_category,normalized_subcategory,
           assignment_status,catalog_status,classification_version,reason_codes,source_fields,input_digest)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
          ON CONFLICT(product_master_id,taxonomy_version,classification_version,input_digest) DO NOTHING RETURNING id`,
        [product.id,nodeId,PRODUCT_TAXONOMY_VERSION,assignment.normalized_profile,assignment.normalized_category,assignment.normalized_subcategory,
          assignment.assignment_status,assignment.catalog_status,PRODUCT_CLASSIFICATION_VERSION,assignment.reason_codes,assignment.source_fields,assignment.input_digest]);
        inserted+=result.rowCount;
      }
      await client.query('COMMIT');
      return {taxonomy_version:PRODUCT_TAXONOMY_VERSION,classification_version:PRODUCT_CLASSIFICATION_VERSION,products:rows.length,assignments:counts,inserted,aliases_inserted:aliasCount,status:'APPLIED'};
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
}
