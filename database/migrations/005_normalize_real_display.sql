BEGIN;

-- Remove duplicate historical source rows before translating provider labels.
DELETE FROM leadgen.sources old_source
USING leadgen.sources current_source
WHERE old_source.company_id = current_source.company_id
  AND old_source.source_url = current_source.source_url
  AND old_source.id <> current_source.id
  AND (
    (old_source.provider_name = 'Company Website' AND current_source.provider_name = '企业官网') OR
    (old_source.provider_name = 'Emirates Online' AND current_source.provider_name = 'Emirates Online 商业目录') OR
    (old_source.provider_name = 'OpenStreetMap / Overpass' AND current_source.provider_name = 'OpenStreetMap 公开地图')
  );

UPDATE leadgen.sources SET provider_name = CASE provider_name
  WHEN 'Company Website' THEN '企业官网'
  WHEN 'Emirates Online' THEN 'Emirates Online 商业目录'
  WHEN 'OpenStreetMap / Overpass' THEN 'OpenStreetMap 公开地图'
  ELSE provider_name END;

UPDATE leadgen.companies SET city = CASE
  WHEN city ~* 'dubai|دبي' THEN 'Dubai'
  WHEN city ~* 'ajman|عجمان' THEN 'Ajman'
  WHEN city ~* 'sharjah|الشارقة' THEN 'Sharjah'
  ELSE 'UAE' END
WHERE data_origin = 'public_web';

UPDATE leadgen.companies c
SET source_record_count = source_totals.source_count
FROM (
  SELECT company_id, count(*)::integer AS source_count
  FROM leadgen.sources GROUP BY company_id
) source_totals
WHERE c.id = source_totals.company_id;

COMMIT;
