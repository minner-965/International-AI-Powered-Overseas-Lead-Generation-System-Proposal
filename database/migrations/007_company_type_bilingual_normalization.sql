BEGIN;

UPDATE leadgen.companies SET company_type = CASE
  WHEN company_type ~* 'excluded|排除' THEN '排除：非女装或 OEM/采购代理模式'
  WHEN importer_wholesaler_fit THEN '女装进口商/批发商候选'
  WHEN is_b2b THEN '女装 B2B 贸易候选'
  ELSE '女装零售候选' END
WHERE data_origin = 'public_web';

COMMIT;
