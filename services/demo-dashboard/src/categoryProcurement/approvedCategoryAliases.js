import {setApprovedCategoryAliases} from '../productMatch/productTaxonomy.js';

// Loads the aliases of the current approved category-scope revision into the product
// classifier. Cached briefly; an approval forces a refresh.
export async function loadApprovedCategoryAliasRows(queryable){
  const result=await queryable.query(`SELECT c.product_profile,c.normalized_category,a.raw_alias,a.normalized_alias,a.language,a.alias_type
    FROM leadgen.dpv_product_category_scope_current c
    LEFT JOIN leadgen.dpv_product_category_scope_aliases a ON a.scope_id=c.id AND a.scope_revision_id=c.scope_revision_id AND a.status='ACTIVE'
    WHERE c.scope_status='ACTIVE' AND c.approval_status='APPROVED'
    ORDER BY c.product_profile,c.normalized_category,a.language,a.normalized_alias`);
  return result.rows;
}

export class ApprovedCategoryAliasRefresher{
  constructor({pool,ttlMs=60000,now=()=>Date.now()}={}){this.pool=pool;this.ttlMs=ttlMs;this.now=now;this.loadedAt=0;this.pending=null;this.count=0;}
  async refresh({force=false}={}){
    if(!this.pool)return this.count;
    if(!force&&this.loadedAt&&this.now()-this.loadedAt<this.ttlMs)return this.count;
    if(!this.pending)this.pending=loadApprovedCategoryAliasRows(this.pool)
      .then(rows=>{this.count=setApprovedCategoryAliases(rows);this.loadedAt=this.now();return this.count;})
      .finally(()=>{this.pending=null;});
    return this.pending;
  }
}
