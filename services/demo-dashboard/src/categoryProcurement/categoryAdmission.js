const confirmedStatuses=[
  'CATEGORY_MATCH_CONFIRMED',
  'CATEGORY_PROCUREMENT_MATCH',
  'CATEGORY_MATCH_NEEDS_BUYING_EVIDENCE'
];

const values=confirmedStatuses.map(value=>`'${value}'`).join(',');

export const confirmedCategoryStatusSql=column=>`${column} IN(${values})`;

export function companyCategoryAdmittedSql(alias='c'){
  return `EXISTS(
    SELECT 1 FROM leadgen.category_procurement_match_results admitted_category
    WHERE admitted_category.company_id=${alias}.id
      AND ${confirmedCategoryStatusSql('admitted_category.match_status')}
      AND NOT EXISTS(
        SELECT 1 FROM leadgen.category_procurement_match_results newer_category
        WHERE newer_category.company_id=admitted_category.company_id
          AND newer_category.product_profile=admitted_category.product_profile
          AND(newer_category.created_at,newer_category.id)>(admitted_category.created_at,admitted_category.id)
      )
  )`;
}

export function confirmedCategoryProfilesSql(alias='c'){
  return `ARRAY(
    SELECT DISTINCT admitted_category.product_profile
    FROM leadgen.category_procurement_match_results admitted_category
    WHERE admitted_category.company_id=${alias}.id
      AND ${confirmedCategoryStatusSql('admitted_category.match_status')}
      AND NOT EXISTS(
        SELECT 1 FROM leadgen.category_procurement_match_results newer_category
        WHERE newer_category.company_id=admitted_category.company_id
          AND newer_category.product_profile=admitted_category.product_profile
          AND(newer_category.created_at,newer_category.id)>(admitted_category.created_at,admitted_category.id)
      )
    ORDER BY admitted_category.product_profile
  )`;
}

