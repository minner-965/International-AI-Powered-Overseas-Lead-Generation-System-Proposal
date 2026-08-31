import crypto from 'node:crypto';
import { ProductTaxonomyService } from '../productMatch/ProductTaxonomyService.js';
import { PRODUCT_TAXONOMY_VERSION } from '../productMatch/productTaxonomy.js';

export const CATALOG_SNAPSHOT_VERSION='product-profile-catalog-snapshot-v1';
const upper=value=>String(value||'').trim().toUpperCase();
const sha=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function buildCatalogSnapshot({product_profile,products=[]}={}){
  const profile=upper(product_profile);
  const rows=products.filter(item=>upper(item.product_profile||item.normalized_profile)===profile);
  const eligible=rows.filter(item=>['CONFIRMED','SUPPORTED'].includes(upper(item.assignment_status))&&upper(item.catalog_status)!=='EXCLUDED');
  const classified=rows.filter(item=>['CONFIRMED','SUPPORTED'].includes(upper(item.assignment_status)));
  const unknown=rows.filter(item=>['UNKNOWN','REVIEW'].includes(upper(item.assignment_status)));
  const excluded=rows.filter(item=>upper(item.catalog_status)==='EXCLUDED');
  return {snapshot_version:CATALOG_SNAPSHOT_VERSION,product_profile:profile,eligible_product_count:eligible.length,
    classified_product_count:classified.length,unknown_product_count:unknown.length,excluded_product_count:excluded.length,
    source_digest:sha(rows.map(item=>[item.product_master_id||item.id,item.input_digest,item.assignment_status,item.catalog_status])),
    coverage_percent:rows.length?Math.round(classified.length/rows.length*10000)/100:0,taxonomy_version:PRODUCT_TAXONOMY_VERSION};
}

export class CatalogSnapshotService{
  constructor({pool,taxonomyService=null}={}){if(!pool)throw new Error('CatalogSnapshotService requires a PostgreSQL pool');this.pool=pool;this.taxonomyService=taxonomyService||new ProductTaxonomyService({pool});}
  async refresh({snapshotVersion=CATALOG_SNAPSHOT_VERSION}={}){
    await this.taxonomyService.classifyAll({apply:true});
    const result=await this.pool.query(`SELECT pm.id product_master_id,
      coalesce(rev.product_profile,pm.product_profile) product_profile,
      a.assignment_status,
      CASE WHEN rev.catalog_status='INACTIVE' THEN 'EXCLUDED' ELSE a.catalog_status END catalog_status,
      a.input_digest
      FROM leadgen.product_master pm
      LEFT JOIN leadgen.product_master_current_revisions rev ON rev.product_master_id=pm.id
      JOIN LATERAL(SELECT x.* FROM leadgen.product_master_taxonomy_assignments x
        WHERE x.product_master_id=pm.id ORDER BY x.created_at DESC,x.id DESC LIMIT 1)a ON true ORDER BY pm.id`);
    const snapshots=[];
    for(const profile of ['WOMENSWEAR','GENERAL_MERCHANDISE']){
      const snapshot={...buildCatalogSnapshot({product_profile:profile,products:result.rows}),snapshot_version:snapshotVersion};
      const saved=await this.pool.query(`INSERT INTO leadgen.product_profile_catalog_snapshots
        (snapshot_version,product_profile,eligible_product_count,classified_product_count,unknown_product_count,excluded_product_count,source_digest,coverage_percent,taxonomy_version)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(snapshot_version,product_profile,source_digest)
        DO UPDATE SET snapshot_version=EXCLUDED.snapshot_version RETURNING *`,[snapshot.snapshot_version,profile,snapshot.eligible_product_count,
        snapshot.classified_product_count,snapshot.unknown_product_count,snapshot.excluded_product_count,snapshot.source_digest,snapshot.coverage_percent,snapshot.taxonomy_version]);
      snapshots.push(saved.rows[0]);
    }
    return snapshots;
  }
  async getLatest(productProfile){const result=await this.pool.query(`SELECT * FROM leadgen.product_profile_catalog_snapshots WHERE product_profile=$1 ORDER BY created_at DESC,id DESC LIMIT 1`,[upper(productProfile)]);return result.rows[0]||null;}
  async ensure(productProfile){return await this.getLatest(productProfile)||(await this.refresh()).find(item=>item.product_profile===upper(productProfile))||null;}
}
