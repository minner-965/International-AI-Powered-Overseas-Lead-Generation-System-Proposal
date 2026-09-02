const PROFILE_VALUES=new Set(['WOMENSWEAR','GENERAL_MERCHANDISE']);
const SOURCE_TYPES=new Set(['MANAGEMENT_APPROVED','PRODUCT_IMPORT','TAXONOMY']);
const ALIAS_TYPES=new Set(['EXACT','SYNONYM','PARENT','CHILD','SIMILAR']);
const APPROVER_ROLES=new Set(['MANAGEMENT','MANAGEMENT_APPROVER']);
const SHA256=/^[0-9a-f]{64}$/i;
const upper=value=>String(value??'').trim().toUpperCase();
const normalizedCategory=value=>upper(value).replace(/&/g,' AND ').replace(/[^A-Z0-9]+/g,'_').replace(/^_+|_+$/g,'');

function required(value,code){const result=String(value??'').trim();if(!result)throw new Error(code);return result;}
function digest(value,code){const result=required(value,code);if(!SHA256.test(result))throw new Error(code);return result.toLowerCase();}
function revisionNumber(value){const result=Number(value);if(!Number.isInteger(result)||result<1)throw new Error('CATEGORY_SCOPE_REVISION_INVALID');return result;}
function profile(value){const result=upper(value);if(!PROFILE_VALUES.has(result))throw new Error('CATEGORY_SCOPE_PROFILE_INVALID');return result;}

export function validateCategoryScopeDraft(input={}){
  const scopes=(input.scopes||[]).map((scope,index)=>({
    client_key:required(scope.client_key||`scope-${index+1}`,'CATEGORY_SCOPE_CLIENT_KEY_REQUIRED'),
    product_profile:profile(scope.product_profile),
    normalized_category:normalizedCategory(scope.normalized_category),
    parent_client_key:scope.parent_client_key?String(scope.parent_client_key):null,
    scope_status:upper(scope.scope_status||'ACTIVE'),taxonomy_node_id:scope.taxonomy_node_id||null,
    source_fact_digest:digest(scope.source_fact_digest,'CATEGORY_SCOPE_FACT_DIGEST_INVALID')
  }));
  if(!scopes.length)throw new Error('CATEGORY_SCOPE_FACTS_REQUIRED');
  if(new Set(scopes.map(scope=>scope.client_key)).size!==scopes.length)throw new Error('CATEGORY_SCOPE_CLIENT_KEY_DUPLICATE');
  for(const scope of scopes){
    if(!scope.normalized_category||!/^[A-Z0-9][A-Z0-9_]{0,99}$/.test(scope.normalized_category))throw new Error('CATEGORY_SCOPE_CATEGORY_INVALID');
    if(!['ACTIVE','INACTIVE','REVIEW'].includes(scope.scope_status))throw new Error('CATEGORY_SCOPE_STATUS_INVALID');
    if(scope.parent_client_key&&!scopes.some(parent=>parent.client_key===scope.parent_client_key&&parent.product_profile===scope.product_profile))throw new Error('CATEGORY_SCOPE_PARENT_INVALID');
  }
  const aliases=(input.aliases||[]).map(alias=>({
    scope_client_key:required(alias.scope_client_key,'CATEGORY_SCOPE_ALIAS_SCOPE_REQUIRED'),
    normalized_alias:normalizedCategory(alias.normalized_alias||alias.raw_alias),
    raw_alias:required(alias.raw_alias||alias.normalized_alias,'CATEGORY_SCOPE_ALIAS_REQUIRED'),
    alias_type:upper(alias.alias_type||'SYNONYM'),language:String(alias.language||'und').toLowerCase(),
    market_code:alias.market_code?upper(alias.market_code):null,status:upper(alias.status||'ACTIVE')
  }));
  for(const alias of aliases){
    if(!scopes.some(scope=>scope.client_key===alias.scope_client_key))throw new Error('CATEGORY_SCOPE_ALIAS_SCOPE_INVALID');
    if(!ALIAS_TYPES.has(alias.alias_type))throw new Error('CATEGORY_SCOPE_ALIAS_TYPE_INVALID');
    if(!['en','es','zh','und'].includes(alias.language))throw new Error('CATEGORY_SCOPE_ALIAS_LANGUAGE_INVALID');
    if(!['ACTIVE','INACTIVE','REVIEW'].includes(alias.status))throw new Error('CATEGORY_SCOPE_ALIAS_STATUS_INVALID');
  }
  return {revision:revisionNumber(input.revision),source_type:SOURCE_TYPES.has(upper(input.source_type))?upper(input.source_type):null,
    source_reference:required(input.source_reference,'CATEGORY_SCOPE_SOURCE_REFERENCE_REQUIRED'),
    source_digest:digest(input.source_digest,'CATEGORY_SCOPE_SOURCE_DIGEST_INVALID'),
    supersedes_revision_id:input.supersedes_revision_id||null,created_by:required(input.actor,'CATEGORY_SCOPE_ACTOR_REQUIRED'),
    scopes,aliases};
}

export class CategoryScopeService{
  constructor({pool}={}){if(!pool)throw new Error('CategoryScopeService requires a PostgreSQL pool');this.pool=pool;}
  async transaction(work){const client=await this.pool.connect();try{await client.query('BEGIN');const value=await work(client);await client.query('COMMIT');return value;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}
  async listCandidates({product_profile=null,limit=500}={}){
    const params=[];let where='';if(product_profile){params.push(profile(product_profile));where='WHERE product_profile=$1';}
    params.push(Math.max(1,Math.min(2000,Number(limit)||500)));
    const result=await this.pool.query(`SELECT * FROM leadgen.dpv_product_category_scope_candidates ${where}
      ORDER BY product_profile,normalized_category,candidate_source,source_reference LIMIT $${params.length}`,params);
    return result.rows;
  }
  async listRevisions({limit=100}={}){
    const result=await this.pool.query(`SELECT r.*,
      (SELECT count(*)::int FROM leadgen.dpv_product_category_scopes s WHERE s.scope_revision_id=r.id) scope_count,
      (SELECT count(*)::int FROM leadgen.dpv_product_category_scope_aliases a WHERE a.scope_revision_id=r.id) alias_count
      FROM leadgen.dpv_product_category_scope_revisions r
      ORDER BY r.revision DESC,r.created_at DESC LIMIT $1`,[Math.max(1,Math.min(500,Number(limit)||100))]);
    return result.rows;
  }
  async insertScopeSet(client,revisionId,scopes,aliases){
    const ids=new Map();const pending=[...scopes];
    while(pending.length){let inserted=0;
      for(let index=pending.length-1;index>=0;index-=1){const scope=pending[index];if(scope.parent_client_key&&!ids.has(scope.parent_client_key))continue;
        const row=await client.query(`INSERT INTO leadgen.dpv_product_category_scopes
          (scope_revision_id,product_profile,normalized_category,parent_scope_id,scope_status,taxonomy_node_id,source_fact_digest)
          VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,[revisionId,scope.product_profile,scope.normalized_category,
          scope.parent_client_key?ids.get(scope.parent_client_key):null,scope.scope_status,scope.taxonomy_node_id,scope.source_fact_digest]);
        ids.set(scope.client_key,row.rows[0].id);pending.splice(index,1);inserted+=1;
      }
      if(!inserted)throw new Error('CATEGORY_SCOPE_PARENT_CYCLE');
    }
    for(const alias of aliases)await client.query(`INSERT INTO leadgen.dpv_product_category_scope_aliases
      (scope_revision_id,scope_id,normalized_alias,raw_alias,alias_type,language,market_code,status)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[revisionId,ids.get(alias.scope_client_key),alias.normalized_alias,
      alias.raw_alias,alias.alias_type,alias.language,alias.market_code,alias.status]);
    return ids;
  }
  async createDraft(input={}){
    const draft=validateCategoryScopeDraft(input);if(!draft.source_type)throw new Error('CATEGORY_SCOPE_SOURCE_TYPE_INVALID');
    return this.transaction(async client=>{await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['leadgen:phase10:category-scope']);
      const existing=await client.query(`SELECT * FROM leadgen.dpv_product_category_scope_revisions
        WHERE revision=$1 AND source_digest=$2`,[draft.revision,draft.source_digest]);
      if(existing.rowCount)return {...existing.rows[0],idempotent_replay:true};
      const revision=await client.query(`INSERT INTO leadgen.dpv_product_category_scope_revisions
        (revision,approval_status,source_type,source_reference,source_digest,supersedes_revision_id,created_by)
        VALUES($1,'DRAFT',$2,$3,$4,$5,$6) RETURNING *`,[draft.revision,draft.source_type,draft.source_reference,
        draft.source_digest,draft.supersedes_revision_id,draft.created_by]);
      await this.insertScopeSet(client,revision.rows[0].id,draft.scopes,draft.aliases);
      return {...revision.rows[0],scope_count:draft.scopes.length,alias_count:draft.aliases.length,idempotent_replay:false};
    });
  }
  async approveRevision(input={}){
    const actor=required(input.actor,'CATEGORY_SCOPE_ACTOR_REQUIRED');const role=upper(input.actor_role);
    if(!APPROVER_ROLES.has(role))throw new Error('CATEGORY_SCOPE_MANAGEMENT_APPROVAL_REQUIRED');
    const newRevision=revisionNumber(input.revision);const sourceReference=required(input.source_reference,'CATEGORY_SCOPE_SOURCE_REFERENCE_REQUIRED');
    const sourceDigest=digest(input.source_digest,'CATEGORY_SCOPE_SOURCE_DIGEST_INVALID');
    const effectiveFrom=input.effective_from?new Date(input.effective_from):new Date();
    if(Number.isNaN(effectiveFrom.getTime()))throw new Error('CATEGORY_SCOPE_EFFECTIVE_FROM_INVALID');
    return this.transaction(async client=>{await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['leadgen:phase10:category-scope']);
      const prior=await client.query(`SELECT * FROM leadgen.dpv_product_category_scope_revisions
        WHERE id=$1 AND approval_status='DRAFT' FOR SHARE`,[input.draft_revision_id]);
      if(!prior.rowCount)throw new Error('CATEGORY_SCOPE_DRAFT_NOT_FOUND');
      const replay=await client.query(`SELECT * FROM leadgen.dpv_product_category_scope_revisions
        WHERE revision=$1 AND approval_status='APPROVED' AND source_digest=$2`,[newRevision,sourceDigest]);
      if(replay.rowCount)return {...replay.rows[0],idempotent_replay:true};
      const sourceScopes=await client.query(`SELECT s.*,
        (SELECT p.normalized_category FROM leadgen.dpv_product_category_scopes p WHERE p.id=s.parent_scope_id) parent_category
        FROM leadgen.dpv_product_category_scopes s WHERE s.scope_revision_id=$1 ORDER BY s.created_at,s.id`,[prior.rows[0].id]);
      if(!sourceScopes.rowCount)throw new Error('CATEGORY_SCOPE_FACTS_REQUIRED');
      const scopes=sourceScopes.rows.map(scope=>({client_key:scope.id,product_profile:scope.product_profile,
        normalized_category:scope.normalized_category,parent_client_key:scope.parent_scope_id||null,
        scope_status:scope.scope_status,taxonomy_node_id:scope.taxonomy_node_id,source_fact_digest:scope.source_fact_digest}));
      const sourceAliases=await client.query(`SELECT * FROM leadgen.dpv_product_category_scope_aliases
        WHERE scope_revision_id=$1 ORDER BY created_at,id`,[prior.rows[0].id]);
      const aliases=sourceAliases.rows.map(alias=>({scope_client_key:alias.scope_id,normalized_alias:alias.normalized_alias,
        raw_alias:alias.raw_alias,alias_type:alias.alias_type,language:alias.language,
        market_code:alias.market_code,status:alias.status}));
      const approved=await client.query(`INSERT INTO leadgen.dpv_product_category_scope_revisions
        (revision,approval_status,effective_from,source_type,source_reference,source_digest,
         supersedes_revision_id,approved_by,approved_at,created_by)
        VALUES($1,'APPROVED',$2,'MANAGEMENT_APPROVED',$3,$4,$5,$6,now(),$6) RETURNING *`,
      [newRevision,effectiveFrom.toISOString(),sourceReference,sourceDigest,prior.rows[0].id,actor]);
      await this.insertScopeSet(client,approved.rows[0].id,scopes,aliases);
      return {...approved.rows[0],scope_count:scopes.length,alias_count:aliases.length,idempotent_replay:false};
    });
  }
}
