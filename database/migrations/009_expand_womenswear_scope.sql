UPDATE leadgen.companies
SET product_categories = ARRAY['全品类女装','连衣裙','上衣','半身裙','裤装','套装','外套','针织衫','内搭','其他女装'],
    company_type = CASE
      WHEN company_type LIKE '排除：%' THEN company_type
      WHEN importer_wholesaler_fit THEN '全品类女装进口商/批发商候选'
      WHEN is_b2b THEN '全品类女装 B2B 贸易候选'
      ELSE '全品类女装零售候选'
    END
WHERE data_origin = 'public_web';

UPDATE leadgen.lead_reviews r
SET product_match = '全品类女装：覆盖所有女性服装品类'
FROM leadgen.companies c
WHERE r.company_id = c.id AND c.data_origin = 'public_web';

UPDATE leadgen.collection_runs
SET target_product = '全品类女装（包括但不限于连衣裙、上衣、半身裙、裤装、套装、外套、针织衫、内搭及其他女装）'
WHERE target_product LIKE '女装（%';
