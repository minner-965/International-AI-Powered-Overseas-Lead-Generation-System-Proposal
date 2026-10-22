import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const taxonomyRoot = path.join(process.env.DPV_RULES_DIR || path.join(projectRoot, 'rules'), 'product-taxonomy', 'v1');
const taxonomy = JSON.parse(fs.readFileSync(path.join(taxonomyRoot, 'taxonomy.json'), 'utf8'));
const aliases = JSON.parse(fs.readFileSync(path.join(taxonomyRoot, 'aliases.json'), 'utf8')).aliases;

export const PRODUCT_TAXONOMY_VERSION = taxonomy.taxonomy_version;

export function normalizeTaxonomyText(value) {
  return String(value || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US')
    .replace(/[’'`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim().replace(/\s+/g, ' ');
}

const indexedAliases = aliases
  .map(item => ({ ...item, normalized_alias:normalizeTaxonomyText(item.alias) }))
  .filter(item => item.normalized_alias)
  .sort((left,right) => right.normalized_alias.length-left.normalized_alias.length || left.alias.localeCompare(right.alias));

// Aliases of management-approved category scopes (current approved revision). They extend the
// built-in dictionary so a newly approved category produces observations without a code change.
let approvedScopeAliases = [];
const SCOPE_ALIAS_MATCH = { EXACT:'EXACT', SYNONYM:'EXACT', CHILD:'EXACT', PARENT:'PARENT', SIMILAR:'ADJACENT' };
const builtInCategories = new Set(taxonomy.profiles.flatMap(profile => [profile.code, ...(profile.categories || []).map(category => category.code)]));

export function approvedScopeAliasEntries(rows = []) {
  const entries = [];
  for (const row of rows) {
    const profile = String(row.product_profile || '').toUpperCase();
    const category = String(row.normalized_category || '').toUpperCase();
    if (!profile || !category) continue;
    if (row.raw_alias || row.normalized_alias) entries.push({ language:row.language || 'und', alias:row.raw_alias || String(row.normalized_alias).replaceAll('_',' '),
      profile, category:category === profile ? null : category, subcategory:null,
      match_type:SCOPE_ALIAS_MATCH[String(row.alias_type || 'SYNONYM').toUpperCase()] || 'ADJACENT', source:'APPROVED_CATEGORY_SCOPE' });
    // A category outside the built-in taxonomy is also recognized by its own name.
    if (!builtInCategories.has(category)) entries.push({ language:'en', alias:category.replaceAll('_',' '), profile, category,
      subcategory:null, match_type:'EXACT', source:'APPROVED_CATEGORY_SCOPE' });
  }
  return entries;
}

export function setApprovedCategoryAliases(rows = []) {
  const seen = new Set();
  approvedScopeAliases = approvedScopeAliasEntries(rows)
    .map(item => ({ ...item, normalized_alias:normalizeTaxonomyText(item.alias) }))
    .filter(item => {
      const key = `${item.normalized_alias}|${item.profile}|${item.category}|${item.match_type}`;
      if (!item.normalized_alias || seen.has(key)) return false;
      seen.add(key); return true;
    });
  return approvedScopeAliases.length;
}

export function getApprovedCategoryAliases() {
  return approvedScopeAliases.map(item => ({ ...item }));
}

function activeAliases(extraAliases) {
  const extra = Array.isArray(extraAliases) ? extraAliases.map(item => ({ ...item, normalized_alias:item.normalized_alias || normalizeTaxonomyText(item.alias) })) : [];
  if (!approvedScopeAliases.length && !extra.length) return indexedAliases;
  return [...indexedAliases, ...approvedScopeAliases, ...extra]
    .sort((left,right) => right.normalized_alias.length-left.normalized_alias.length || String(left.alias).localeCompare(String(right.alias)));
}

function containsAlias(text, alias) {
  if (!text || !alias) return false;
  if (/[^\u0000-\u007f]/.test(alias)) return text.includes(alias);
  return (` ${text} `).includes(` ${alias} `);
}

export function getProductTaxonomy() {
  return taxonomy;
}

export function getProductTaxonomyAliases() {
  return indexedAliases.map(item => ({ ...item }));
}

export function taxonomyRelation(leftCategory, rightCategory) {
  const left = String(leftCategory || '').toUpperCase();
  const right = String(rightCategory || '').toUpperCase();
  if (!left || !right) return 'UNKNOWN';
  if (left === right) return 'SAME_CATEGORY';
  const relation = taxonomy.relations.find(item =>
    (item.left === left && item.right === right) || (item.left === right && item.right === left));
  if (!relation) return 'UNRELATED';
  return relation.relation === 'PARENT' ? 'PARENT_CATEGORY' : 'ADJACENT_CATEGORY';
}

export function normalizeProductObservation(input = {}, { aliases:extraAliases = null } = {}) {
  const explicitProfile = String(input.product_profile || input.normalized_profile || '').trim().toUpperCase();
  const fields = [
    ['raw_product_name',input.raw_product_name],
    ['raw_category',input.raw_category],
    ['raw_brand_or_department',input.raw_brand_or_department]
  ];
  const normalizedFields = fields.map(([name,value]) => [name,normalizeTaxonomyText(value)]).filter(([,value]) => value);
  if (!normalizedFields.length) {
    return {
      taxonomy_version:PRODUCT_TAXONOMY_VERSION,normalized_profile:'UNKNOWN',normalized_category:null,
      normalized_subcategory:null,assignment_status:'UNKNOWN',normalization_status:'UNKNOWN',
      reason_codes:['PRODUCT_TAXONOMY_EVIDENCE_MISSING'],source_fields:[]
    };
  }

  const matches = [];
  const candidates = activeAliases(extraAliases);
  for (const [field,text] of normalizedFields) {
    for (const alias of candidates) {
      if (containsAlias(text,alias.normalized_alias)) matches.push({ ...alias,field });
    }
  }
  if (!matches.length) {
    return {
      taxonomy_version:PRODUCT_TAXONOMY_VERSION,normalized_profile:explicitProfile || 'UNKNOWN',
      normalized_category:null,normalized_subcategory:null,assignment_status:'UNKNOWN',normalization_status:'UNKNOWN',
      reason_codes:['PRODUCT_TAXONOMY_ALIAS_NOT_FOUND'],source_fields:normalizedFields.map(([field])=>field)
    };
  }

  const ambiguous = matches.some(item => item.match_type === 'AMBIGUOUS' || item.profile === 'UNKNOWN');
  const supported = matches.filter(item => item.profile !== 'UNKNOWN');
  const profiles = [...new Set(supported.map(item => item.profile))];
  const crossProfile = profiles.length > 1 || (explicitProfile && explicitProfile !== 'UNKNOWN' && profiles.some(value=>value !== explicitProfile));
  if (ambiguous || crossProfile) {
    return {
      taxonomy_version:PRODUCT_TAXONOMY_VERSION,normalized_profile:crossProfile ? 'UNKNOWN' : (profiles[0] || 'UNKNOWN'),
      normalized_category:null,normalized_subcategory:null,assignment_status:'REVIEW',normalization_status:'REVIEW',
      reason_codes:[crossProfile?'PRODUCT_TAXONOMY_CROSS_PROFILE_CONFLICT':'PRODUCT_TAXONOMY_AMBIGUOUS_ALIAS'],
      source_fields:[...new Set(matches.map(item=>item.field))]
    };
  }

  const profile = profiles[0] || 'UNKNOWN';
  const compatible = supported.filter(item => item.profile === profile);
  const specific = compatible.find(item => item.subcategory) || compatible.find(item => item.category) || compatible[0];
  const assignmentStatus = specific?.category ? (specific.match_type === 'EXACT' ? 'CONFIRMED' : 'SUPPORTED') : 'REVIEW';
  return {
    taxonomy_version:PRODUCT_TAXONOMY_VERSION,
    normalized_profile:profile,
    normalized_category:specific?.category || null,
    normalized_subcategory:specific?.subcategory || null,
    assignment_status:assignmentStatus,
    normalization_status:assignmentStatus,
    reason_codes:[specific?.subcategory?'PRODUCT_TAXONOMY_EXACT_SUBCATEGORY':specific?.category?'PRODUCT_TAXONOMY_CATEGORY_SUPPORTED':'PRODUCT_TAXONOMY_PROFILE_ONLY'],
    source_fields:[...new Set(compatible.map(item=>item.field))]
  };
}

export function classifyProductMaster(product = {}) {
  const rawProfile = String(product.product_profile || 'UNKNOWN').toUpperCase();
  if (rawProfile === 'UNKNOWN') {
    return {
      taxonomy_version:PRODUCT_TAXONOMY_VERSION,normalized_profile:'UNKNOWN',normalized_category:null,
      normalized_subcategory:null,assignment_status:'UNKNOWN',normalization_status:'UNKNOWN',
      reason_codes:['SOURCE_PRODUCT_PROFILE_UNKNOWN'],source_fields:[]
    };
  }
  const result = normalizeProductObservation({
    product_profile:rawProfile,raw_product_name:product.product_name,raw_category:product.category
  });
  if (result.normalized_profile !== rawProfile || result.assignment_status === 'REVIEW') {
    return { ...result,normalized_profile:rawProfile,normalized_category:null,normalized_subcategory:null,
      assignment_status:'REVIEW',normalization_status:'REVIEW',
      reason_codes:[...new Set([...(result.reason_codes || []),'SOURCE_PROFILE_CLASSIFICATION_REVIEW'])] };
  }
  return result;
}

export function flattenTaxonomyNodes() {
  const rows = [];
  for (const profile of taxonomy.profiles) {
    rows.push({ canonical_code:profile.code,canonical_name:profile.name,product_profile:profile.code,node_type:'PRODUCT_PROFILE',parent_code:null,attribute_set:profile.attribute_set || [] });
    for (const category of profile.categories) {
      rows.push({ canonical_code:category.code,canonical_name:category.name,product_profile:profile.code,node_type:'CATEGORY',parent_code:profile.code,attribute_set:profile.attribute_set || [] });
      for (const subcategory of category.subcategories || []) {
        rows.push({ canonical_code:subcategory,canonical_name:subcategory.replaceAll('_',' '),product_profile:profile.code,node_type:'SUBCATEGORY',parent_code:category.code,attribute_set:profile.attribute_set || [] });
      }
    }
  }
  return rows;
}
