import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

// Market search languages come from the generated registry seed (CLDR official languages that
// have search vocabulary, English otherwise). Role and procurement wording per language is
// search vocabulary only, never identity evidence.
const seedPath=[
  fileURLToPath(new URL('../../../../config/search/market-registry-seed.v1.json',import.meta.url)),
  fileURLToPath(new URL('../../config/search/market-registry-seed.v1.json',import.meta.url))
].find(path=>existsSync(path));
const seed=seedPath?JSON.parse(readFileSync(seedPath,'utf8')):{markets:[]};
const LANGUAGES=new Map(seed.markets.map(row=>[row.market_code,Object.freeze([...row.languages])]));

export function marketSearchLanguages(countryCode){
  return LANGUAGES.get(String(countryCode||'').trim().toUpperCase())||Object.freeze(['en']);
}
export function primaryMarketLanguage(countryCode){return marketSearchLanguages(countryCode)[0]||'en';}

export const BUYER_ROLE_TERMS=Object.freeze({
  en:Object.freeze(['buyer','procurement manager','purchasing manager','category manager','sourcing manager']),
  ar:Object.freeze(['مدير المشتريات','مسؤول المشتريات']),
  es:Object.freeze(['Comprador','Compradora','Gerente de Compras','Director de Compras','Jefe de Compras',
    'Abastecimiento','Gerente de Categoría','Importaciones','Sourcing']),
  de:Object.freeze(['Einkäufer','Einkaufsleiter','Leiter Einkauf','Category Manager','Beschaffung']),
  fr:Object.freeze(['acheteur','responsable achats','directeur des achats','chef de produit','sourcing']),
  pt:Object.freeze(['comprador','gerente de compras','diretor de compras','gerente de categoria','suprimentos']),
  it:Object.freeze(['buyer','responsabile acquisti','direttore acquisti','category manager','ufficio acquisti']),
  tr:Object.freeze(['satın alma müdürü','satın alma sorumlusu','kategori müdürü','tedarik'])
});

// Decision-maker enrichment wording (role, supplier access, barrier) per language.
export const ENRICHMENT_TERMS=Object.freeze({
  en:Object.freeze({roles:['buyer','procurement manager','purchasing manager','category manager','sourcing manager'],
    access:['supplier registration','vendor registration','procurement','become a supplier'],
    barriers:['approved vendor','prequalification','invitation only']}),
  es:Object.freeze({roles:['comprador','gerente de compras','abastecimiento','adquisiciones','buyer'],
    access:['registro de proveedores','alta de proveedores','portal de proveedores','compras'],
    barriers:['proveedores aprobados','precalificación','solo por invitación']}),
  de:Object.freeze({roles:['Einkäufer','Einkaufsleiter','Leiter Einkauf','Beschaffung','buyer'],
    access:['Lieferantenregistrierung','Lieferant werden','Lieferantenportal','Einkauf'],
    barriers:['zugelassene Lieferanten','Präqualifizierung','nur auf Einladung']}),
  fr:Object.freeze({roles:['acheteur','responsable achats','directeur des achats','sourcing','buyer'],
    access:['référencement fournisseur','devenir fournisseur','portail fournisseurs','achats'],
    barriers:['fournisseurs agréés','préqualification','sur invitation uniquement']}),
  pt:Object.freeze({roles:['comprador','gerente de compras','suprimentos','diretor de compras','buyer'],
    access:['cadastro de fornecedores','seja um fornecedor','portal de fornecedores','compras'],
    barriers:['fornecedores homologados','pré-qualificação','somente por convite']}),
  it:Object.freeze({roles:['buyer','responsabile acquisti','direttore acquisti','ufficio acquisti','category manager'],
    access:['albo fornitori','diventa fornitore','portale fornitori','acquisti'],
    barriers:['fornitori qualificati','prequalifica','solo su invito']}),
  tr:Object.freeze({roles:['satın alma müdürü','satın alma sorumlusu','kategori müdürü','tedarik','buyer'],
    access:['tedarikçi kaydı','tedarikçi olun','tedarikçi portalı','satın alma'],
    barriers:['onaylı tedarikçiler','ön yeterlilik','yalnızca davetle']})
});
