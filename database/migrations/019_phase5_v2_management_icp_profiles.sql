BEGIN;

-- The explicit product profile is persisted for new V2.2 research jobs. Legacy
-- categories outside the two confirmed management scopes remain NULL rather
-- than being guessed.
ALTER TABLE leadgen.research_jobs
    ADD COLUMN IF NOT EXISTS product_profile text;

UPDATE leadgen.research_jobs
SET product_profile = CASE
    WHEN upper(regexp_replace(product_category, '[^a-zA-Z0-9]+', '_', 'g')) IN
         ('WOMEN_S_APPAREL','WOMENS_APPAREL','WOMENSWEAR','DRESSES','TOPS','SKIRTS','TROUSERS','OUTERWEAR','KNITWEAR')
      THEN 'WOMENSWEAR'
    WHEN upper(regexp_replace(product_category, '[^a-zA-Z0-9]+', '_', 'g')) IN
         ('GENERAL_MERCHANDISE','HOUSEHOLD_GOODS','DAILY_USE_GOODS','HOMEWARE','HOME_AND_LIVING','NON_FOOD')
      THEN 'GENERAL_MERCHANDISE'
    ELSE product_profile
END
WHERE product_profile IS NULL;

ALTER TABLE leadgen.research_jobs
    DROP CONSTRAINT IF EXISTS research_jobs_product_profile_check;
ALTER TABLE leadgen.research_jobs
    ADD CONSTRAINT research_jobs_product_profile_check
    CHECK (product_profile IS NULL OR product_profile IN ('WOMENSWEAR','GENERAL_MERCHANDISE'));

CREATE INDEX IF NOT EXISTS idx_research_jobs_product_profile
    ON leadgen.research_jobs (product_profile, created_at DESC);

UPDATE leadgen.icp_profiles
SET status='RETIRED', retired_at=coalesce(retired_at,now())
WHERE profile_type='MANAGEMENT_BASELINE'
  AND version='baseline-v1'
  AND status<>'RETIRED';

INSERT INTO leadgen.icp_profiles (
    id,name,profile_type,version,status,market_scope,product_scope,
    feature_coverage,calculation_version,activated_at
)
VALUES
    ('00000000-0000-5000-8000-000000000002',
     'DPV Management Baseline ICP — Womenswear',
     'MANAGEMENT_BASELINE','womenswear-baseline-v2','ACTIVE',
     ARRAY['AE','MX','BD'],ARRAY['WOMENSWEAR'],75,'management-baseline-v2',now()),
    ('00000000-0000-5000-8000-000000000003',
     'DPV Management Baseline ICP — General Merchandise',
     'MANAGEMENT_BASELINE','general-merchandise-baseline-v1','ACTIVE',
     ARRAY['AE','MX','BD'],ARRAY['GENERAL_MERCHANDISE'],75,'management-baseline-v2',now())
ON CONFLICT (profile_type, version, market_scope, product_scope)
DO UPDATE SET
    name=excluded.name,
    status='ACTIVE',
    feature_coverage=excluded.feature_coverage,
    calculation_version=excluded.calculation_version,
    activated_at=coalesce(leadgen.icp_profiles.activated_at,now()),
    retired_at=NULL;

INSERT INTO leadgen.icp_profile_features
    (profile_id,feature_key,feature_value,coverage,sample_size,calculation_version)
VALUES
    ('00000000-0000-5000-8000-000000000002','priority_markets',
     '{"values":["AE","MX"]}',100,0,'management-baseline-v2'),
    ('00000000-0000-5000-8000-000000000002','expansion_markets',
     '{"values":["BD"]}',100,0,'management-baseline-v2'),
    ('00000000-0000-5000-8000-000000000002','markets',
     '{"values":["AE","MX","BD"]}',100,0,'management-baseline-v2'),
    ('00000000-0000-5000-8000-000000000002','buyer_types',
     '{"values":["IMPORTER","WHOLESALER","DISTRIBUTOR","CHAIN_APPAREL_RETAILER","DEPARTMENT_STORE","LARGE_RETAIL_GROUP","REGIONAL_RETAIL_CHAIN","APPAREL_IMPORTER","APPAREL_WHOLESALER","APPAREL_DISTRIBUTOR"]}',100,0,'management-baseline-v2'),
    ('00000000-0000-5000-8000-000000000002','organization_types',
     '{"values":["CHAIN_APPAREL_RETAILER","DEPARTMENT_STORE","LARGE_RETAIL_GROUP","REGIONAL_RETAIL_CHAIN","APPAREL_IMPORTER","APPAREL_WHOLESALER","APPAREL_DISTRIBUTOR"]}',100,0,'management-baseline-v2'),
    ('00000000-0000-5000-8000-000000000002','channels',
     '{"values":["CHAIN_APPAREL_RETAILER","DEPARTMENT_STORE","LARGE_RETAIL_GROUP","REGIONAL_RETAIL_CHAIN","APPAREL_IMPORTER","APPAREL_WHOLESALER","APPAREL_DISTRIBUTOR"]}',100,0,'management-baseline-v2'),
    ('00000000-0000-5000-8000-000000000002','buyer_roles',
     '{"values":["BUYER","SENIOR_BUYER","CATEGORY_BUYER","FASHION_BUYER","WOMENSWEAR_BUYER","APPAREL_BUYER","MERCHANDISE_BUYER","PURCHASING_MANAGER","PROCUREMENT_MANAGER","HEAD_OF_BUYING","SOURCING_MANAGER","CATEGORY_MANAGER"]}',100,0,'management-baseline-v2'),
    ('00000000-0000-5000-8000-000000000002','product_categories',
     '{"values":["WOMENSWEAR","DRESSES","TOPS","SKIRTS","TROUSERS","OUTERWEAR","KNITWEAR"]}',100,0,'management-baseline-v2'),
    ('00000000-0000-5000-8000-000000000002','company_sizes',
     '{"values":["SMALL","MEDIUM","LARGE","ENTERPRISE"]}',100,0,'management-baseline-v2'),
    ('00000000-0000-5000-8000-000000000002','distribution_patterns',
     '{"values":["REGIONAL_DISTRIBUTION","WHOLESALE_NETWORK","MULTI_STORE","B2B_SUPPLY","RETAIL_CHAIN"]}',100,0,'management-baseline-v2'),
    ('00000000-0000-5000-8000-000000000002','exclusions',
     '{"values":["SMALL_SINGLE_STORE_RETAIL","CONSUMER","INDIVIDUAL_SELLER","SOURCING_AGENT","PROCUREMENT_AGENT","OEM_ONLY","ECOMMERCE_ONLY_SMALL_SELLER","UNVERIFIED_SOCIAL_ACCOUNT"]}',100,0,'management-baseline-v2'),
    ('00000000-0000-5000-8000-000000000002','commercial_moq',
     '{"status":"NOT_CONFIGURED"}',0,0,'management-baseline-v2'),
    ('00000000-0000-5000-8000-000000000002','historical_win_similarity',
     '{"status":"HISTORICAL_DATA_PENDING"}',0,0,'management-baseline-v2'),

    ('00000000-0000-5000-8000-000000000003','priority_markets',
     '{"values":["AE","MX"]}',100,0,'management-baseline-v2'),
    ('00000000-0000-5000-8000-000000000003','expansion_markets',
     '{"values":["BD"]}',100,0,'management-baseline-v2'),
    ('00000000-0000-5000-8000-000000000003','markets',
     '{"values":["AE","MX","BD"]}',100,0,'management-baseline-v2'),
    ('00000000-0000-5000-8000-000000000003','buyer_types',
     '{"values":["IMPORTER","WHOLESALER","DISTRIBUTOR","SUPERMARKET","DEPARTMENT_STORE","LARGE_RETAIL_GROUP","REGIONAL_RETAIL_CHAIN","LIFESTYLE_DAILY_USE_GOODS_CHAIN","GENERAL_MERCHANDISE_IMPORTER","GENERAL_MERCHANDISE_WHOLESALER","GENERAL_MERCHANDISE_DISTRIBUTOR"]}',100,0,'management-baseline-v2'),
    ('00000000-0000-5000-8000-000000000003','organization_types',
     '{"values":["SUPERMARKET","DEPARTMENT_STORE","LARGE_RETAIL_GROUP","REGIONAL_RETAIL_CHAIN","LIFESTYLE_DAILY_USE_GOODS_CHAIN","GENERAL_MERCHANDISE_IMPORTER","GENERAL_MERCHANDISE_WHOLESALER","GENERAL_MERCHANDISE_DISTRIBUTOR"]}',100,0,'management-baseline-v2'),
    ('00000000-0000-5000-8000-000000000003','channels',
     '{"values":["SUPERMARKET","DEPARTMENT_STORE","LARGE_RETAIL_GROUP","REGIONAL_RETAIL_CHAIN","LIFESTYLE_DAILY_USE_GOODS_CHAIN","GENERAL_MERCHANDISE_IMPORTER","GENERAL_MERCHANDISE_WHOLESALER","GENERAL_MERCHANDISE_DISTRIBUTOR"]}',100,0,'management-baseline-v2'),
    ('00000000-0000-5000-8000-000000000003','buyer_roles',
     '{"values":["BUYER","SENIOR_BUYER","CATEGORY_BUYER","MERCHANDISE_BUYER","GENERAL_MERCHANDISE_BUYER","HOUSEHOLD_BUYER","HOME_AND_LIVING_BUYER","NON_FOOD_BUYER","PURCHASING_MANAGER","PROCUREMENT_MANAGER","HEAD_OF_BUYING","SOURCING_MANAGER","CATEGORY_MANAGER"]}',100,0,'management-baseline-v2'),
    ('00000000-0000-5000-8000-000000000003','product_categories',
     '{"values":["GENERAL_MERCHANDISE","HOUSEHOLD_GOODS","HOMEWARE","DAILY_USE_GOODS","HOME_AND_LIVING","NON_FOOD"]}',100,0,'management-baseline-v2'),
    ('00000000-0000-5000-8000-000000000003','company_sizes',
     '{"values":["SMALL","MEDIUM","LARGE","ENTERPRISE"]}',100,0,'management-baseline-v2'),
    ('00000000-0000-5000-8000-000000000003','distribution_patterns',
     '{"values":["REGIONAL_DISTRIBUTION","WHOLESALE_NETWORK","MULTI_STORE","B2B_SUPPLY","RETAIL_CHAIN","SUPERMARKET_CHAIN"]}',100,0,'management-baseline-v2'),
    ('00000000-0000-5000-8000-000000000003','exclusions',
     '{"values":["SMALL_SINGLE_STORE_RETAIL","CONSUMER","INDIVIDUAL_SELLER","SOURCING_AGENT","PROCUREMENT_AGENT","OEM_ONLY","ECOMMERCE_ONLY_SMALL_SELLER","UNVERIFIED_SOCIAL_ACCOUNT"]}',100,0,'management-baseline-v2'),
    ('00000000-0000-5000-8000-000000000003','commercial_moq',
     '{"status":"NOT_CONFIGURED"}',0,0,'management-baseline-v2'),
    ('00000000-0000-5000-8000-000000000003','historical_win_similarity',
     '{"status":"HISTORICAL_DATA_PENDING"}',0,0,'management-baseline-v2')
ON CONFLICT (profile_id, feature_key)
DO UPDATE SET
    feature_value=excluded.feature_value,
    coverage=excluded.coverage,
    sample_size=excluded.sample_size,
    calculation_version=excluded.calculation_version;

COMMIT;
