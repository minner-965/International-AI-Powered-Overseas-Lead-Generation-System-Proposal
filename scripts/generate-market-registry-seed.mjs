#!/usr/bin/env node
// Dev-time generator for the research market registry seed (migration 065 and
// config/search/market-registry-seed.v1.json). Nothing here runs in production.
//
// Reused public data (see docs/REUSE_CANDIDATE_REGISTRY.md):
//   i18n-iso-countries@7.14.0 (MIT)       country names per language (ISO 3166-1)
//   countries-and-timezones@3.11.0 (MIT)  IANA time zones per country
//   cldr-core@48.2.0 (Unicode-3.0)        official languages (territoryInfo), weekend days (weekData),
//                                         primary zones (primaryZones)
// Install them outside the repository and point --modules at that folder:
//   npm install --prefix <dir> i18n-iso-countries@7.14.0 countries-and-timezones@3.11.0 cldr-core@48.2.0
//   node scripts/generate-market-registry-seed.mjs --modules <dir>/node_modules [--sql]
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const args=process.argv.slice(2);
const option=name=>{const index=args.indexOf(name);return index>=0?args[index+1]:null;};
const modules=option('--modules');
if(!modules){console.error('Usage: --modules <node_modules folder with the three reference packages> [--sql]');process.exit(2);}
const require=createRequire(path.join(path.resolve(modules),'noop.js'));
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

// Markets selected by management (plan section A3). AE and MX already exist and are never changed:
// the migration inserts with ON CONFLICT DO NOTHING and the SQL output leaves them out.
const EXISTING=new Set(['AE','MX']);
export const MARKETS='US CA GB DE FR IT ES NL PL SA AE QA KW IL TR MX BR CL CO PE AU NZ JP KR SG MY TH VN PH ID IN ZA NG KE EG MA'.split(' ');
// Search vocabulary languages available in config/search/query-strategies.v2.json.
const strategies=JSON.parse(readFileSync(path.join(root,'config/search/query-strategies.v2.json'),'utf8'));
const VOCABULARY=Object.keys(strategies.locales);
// Same buyer types as the existing AE/MX rows.
const BUYER_TYPES=['Department Store','Large Retail Group','Regional Retail Chain','Importer','Wholesaler','Distributor'];
// Business hub zone for countries spanning several zones and without a CLDR primary zone.
const HUB_ZONES={US:'America/New_York',CA:'America/Toronto',BR:'America/Sao_Paulo',AU:'Australia/Sydney',ID:'Asia/Jakarta',
  MX:'America/Mexico_City',KW:'Asia/Kuwait',NL:'Europe/Amsterdam',VN:'Asia/Ho_Chi_Minh',MY:'Asia/Kuala_Lumpur'};
// Short English search names where the ISO official form is not the common business name.
const ENGLISH_NAMES={US:'United States',TR:'Turkey',KR:'South Korea'};
// Official languages spoken by at least this share of the population drive search languages.
const MIN_LANGUAGE_SHARE=25;
const DAY_NUMBER={mon:1,tue:2,wed:3,thu:4,fri:5,sat:6,sun:7};

const countries=require('i18n-iso-countries');
for(const language of VOCABULARY)countries.registerLocale(require(`i18n-iso-countries/langs/${language}.json`));
const timezones=require('countries-and-timezones');
const week=require('cldr-core/supplemental/weekData.json').supplemental.weekData;
const primaryZones=require('cldr-core/supplemental/primaryZones.json').supplemental.primaryZones;
const territory=require('cldr-core/supplemental/territoryInfo.json').supplemental.territoryInfo;

function workdays(code){
  const start=DAY_NUMBER[week.weekendStart[code]||week.weekendStart['001']];
  const end=DAY_NUMBER[week.weekendEnd[code]||week.weekendEnd['001']];
  const weekend=new Set();for(let day=start;;day=day%7+1){weekend.add(day);if(day===end)break;}
  return [1,2,3,4,5,6,7].filter(day=>!weekend.has(day));
}
function timezone(code){
  const zone=primaryZones[code]||HUB_ZONES[code]||(()=>{const zones=timezones.getCountry(code).timezones;
    if(zones.length!==1)throw new Error(`Choose a hub zone for ${code}: ${zones.join(', ')}`);return zones[0];})();
  if(!timezones.getCountry(code,{deprecated:true}).timezones.includes(zone)&&!HUB_ZONES[code])throw new Error(`Zone ${zone} is not listed for ${code}`);
  return zone;
}
function languages(code){
  const official=Object.entries(territory[code].languagePopulation||{})
    .filter(([,value])=>['official','de_facto_official'].includes(value._officialStatus)&&Number(value._populationPercent)>=MIN_LANGUAGE_SHARE)
    .sort((a,b)=>Number(b[1]._populationPercent)-Number(a[1]._populationPercent)).map(([language])=>language.split('_')[0]);
  // English is kept as the business lingua franca; languages without search vocabulary fall back to it.
  return [...new Set([...official.filter(language=>VOCABULARY.includes(language)),'en'])];
}
export function buildSeed(){
  return MARKETS.map(code=>{
    const searchLanguages=languages(code);
    const countryName=ENGLISH_NAMES[code]||countries.getName(code,'en');
    const terms=Object.fromEntries(searchLanguages.filter(language=>language!=='en').map(language=>[language,countries.getName(code,language)]));
    return {market_code:code,country_name:countryName,languages:searchLanguages,buyer_types:BUYER_TYPES,timezone:timezone(code),
      business_send_window:{days:workdays(code),start:'09:00',end:'17:00'},country_terms:{en:countryName,...terms}};
  });
}
const quote=value=>`'${String(value).replace(/'/g,"''")}'`;
const array=values=>`ARRAY[${values.map(quote).join(',')}]::text[]`;
export function seedSql(seed){
  return seed.filter(row=>!EXISTING.has(row.market_code)).map(row=>`  (${[quote(row.market_code),quote(row.country_name),array(row.languages),array(row.buyer_types),quote(row.timezone),
    `${quote(JSON.stringify(row.business_send_window))}::jsonb`,`${quote(JSON.stringify(row.country_terms))}::jsonb`].join(',')})`).join(',\n');
}

const seed=buildSeed();
const output=path.join(root,'config/search/market-registry-seed.v1.json');
mkdirSync(path.dirname(output),{recursive:true});
writeFileSync(output,`${JSON.stringify({version:1,generated_by:'scripts/generate-market-registry-seed.mjs',
  sources:['i18n-iso-countries@7.14.0','countries-and-timezones@3.11.0','cldr-core@48.2.0'],
  vocabulary_languages:VOCABULARY,existing_rows_unchanged:[...EXISTING],markets:seed},null,2)}\n`);
console.log(`Wrote ${seed.length} markets to ${path.relative(root,output)}`);
if(args.includes('--sql'))console.log(seedSql(seed));
