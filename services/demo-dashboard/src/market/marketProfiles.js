const GENERIC = Object.freeze({
  profileKey: 'GENERIC',
  countryCode: 'XX',
  countryName: '',
  providerCountryName: '',
  defaultLanguage: 'en',
  secondaryLanguages: [],
  searchMarketNames: [],
  businessSuffixes: ['Ltd', 'Limited', 'PLC', 'Inc', 'Corporation', 'Company'],
  importerTerms: ['importer', 'import company'],
  wholesalerTerms: ['wholesaler', 'wholesale supplier'],
  distributorTerms: ['distributor', 'distribution company'],
  tradingTerms: ['trading company', 'supplier'],
  retailTerms: ['retail chain', 'organized retailer'],
  departmentStoreTerms: ['department store'],
  supermarketTerms: ['supermarket chain', 'supermarket buying organization'],
  smeTerms: ['regional', 'independent', 'wholesale supplier'],
  strategicTerms: ['regional distribution group', 'distribution network'],
  phoneCountryCode: null,
  nationalPhonePrefix: '0',
  nationalPhoneLengths: [],
  allowNationalWithoutPrefix: false,
  preferredSocialPlatforms: ['LINKEDIN', 'FACEBOOK', 'INSTAGRAM'],
  officialDirectorySources: [],
  directoryDomains: ['kompass.com'],
  newsDomains: ['reuters.com', 'bloomberg.com', 'forbes.com'],
  marketplaceDomains: ['alibaba.com', 'noon.com', 'aliexpress.com', 'temu.com'],
  marketplaceDomainPrefixes: ['amazon.'],
  pageRoleTerms: ['about', 'company', 'products', 'brands', 'wholesale', 'distribution', 'partners', 'locations', 'contact'],
  decisionMakerTerms: ['buyer', 'senior buyer', 'head of buying', 'purchasing manager', 'procurement manager', 'category manager', 'merchandising manager', 'sourcing manager', 'import manager', 'commercial director'],
  procurementDepartmentTerms: ['buying department', 'procurement department', 'purchasing department', 'merchandising department', 'sourcing department'],
  supplierAccessTerms: ['supplier registration', 'vendor registration', 'become a supplier', 'supplier onboarding', 'procurement portal', 'supplier prequalification', 'approved vendor', 'tender', 'RFQ', 'RFP', 'supplier requirements'],
  supplierBarrierTerms: ['invitation only', 'exclusive supplier', 'fixed supplier', 'approved vendor list', 'local sourcing only', 'prequalification required', 'supplier code of conduct', 'centralized procurement'],
  productDiscoveryTerms: Object.freeze({
    WOMENSWEAR: ['women clothing', 'dresses', 'tops', 'skirts', 'womenswear'],
    GENERAL_MERCHANDISE: ['home living', 'household', 'pet products', 'products', 'brands']
  }),
  categoryBuyerDiscoveryTerms: Object.freeze({
    WOMENSWEAR: Object.freeze({
      category: ['women clothing', 'dresses', 'brands women'],
      directBuyer: ['stores', 'retail group', 'buying department'],
      distribution: ['wholesale', 'distributor', 'importer', 'warehouse', 'dealer network'],
      exclusion: ['sourcing agent', 'broker', 'OEM manufacturer']
    }),
    GENERAL_MERCHANDISE: Object.freeze({
      category: ['home living', 'household', 'pet products', 'brands'],
      directBuyer: ['stores', 'retail group', 'buying department'],
      distribution: ['wholesale', 'distributor', 'importer', 'warehouse', 'dealer network'],
      exclusion: ['sourcing agent', 'broker', 'OEM manufacturer']
    })
  }),
  locationTerms: [],
  businessEvidenceTerms: Object.freeze({
    importer: ['importer', 'import company', 'importing'],
    wholesaler: ['wholesaler', 'wholesale supplier', 'wholesale'],
    distributor: ['distributor', 'distribution company', 'distribution'],
    trading: ['trading company', 'supplier'],
    company: ['company', 'business', 'supplier', 'products']
  })
});

const PROFILES = Object.freeze({
  AE: Object.freeze({
    ...GENERIC,
    profileKey: 'AE',
    countryCode: 'AE',
    countryName: 'United Arab Emirates',
    providerCountryName: 'united arab emirates',
    searchMarketNames: ['UAE', 'United Arab Emirates'],
    businessSuffixes: ['LLC', 'L.L.C.', 'FZE', 'FZCO', 'PJSC', 'Ltd', 'Limited'],
    tradingTerms: ['general trading', 'trading company', 'commercial trading'],
    smeTerms: ['regional', 'independent', 'wholesale supplier', 'local distributor'],
    strategicTerms: ['regional distribution group', 'distribution network', 'retail group'],
    phoneCountryCode: '+971',
    nationalPhoneLengths: [9, 10],
    preferredSocialPlatforms: ['LINKEDIN', 'INSTAGRAM', 'FACEBOOK', 'WHATSAPP'],
    officialDirectorySources: ['Emirates Online', 'UAE business directory'],
    directoryDomains: [...GENERIC.directoryDomains, 'atninfo.com', 'yellowpages.ae', 'emirates-online.net', 'connect.ae'],
    newsDomains: [...GENERIC.newsDomains, 'thenationalnews.com', 'gulfnews.com', 'khaleejtimes.com'],
    pageRoleTerms: [...GENERIC.pageRoleTerms, 'who we are', 'enquiry'],
    decisionMakerTerms: [...GENERIC.decisionMakerTerms],
    procurementDepartmentTerms: [...GENERIC.procurementDepartmentTerms],
    supplierAccessTerms: [...GENERIC.supplierAccessTerms, 'supplier registration UAE', 'vendor registration UAE'],
    supplierBarrierTerms: [...GENERIC.supplierBarrierTerms],
    productDiscoveryTerms: Object.freeze({
      WOMENSWEAR: ['women clothing', 'dresses', 'tops', 'skirts', 'womenswear'],
      GENERAL_MERCHANDISE: ['home living', 'household', 'pet products', 'products', 'brands']
    }),
    categoryBuyerDiscoveryTerms: GENERIC.categoryBuyerDiscoveryTerms,
    locationTerms: ['United Arab Emirates', 'UAE', 'Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Ras Al Khaimah', 'GCC', 'Middle East']
  }),
  BD: Object.freeze({
    ...GENERIC,
    profileKey: 'BD',
    countryCode: 'BD',
    countryName: 'Bangladesh',
    providerCountryName: 'bangladesh',
    secondaryLanguages: ['bn'],
    searchMarketNames: ['Bangladesh'],
    businessSuffixes: ['Ltd', 'Limited', 'PLC', 'Private Limited'],
    tradingTerms: ['trading company', 'trading house', 'supplier'],
    smeTerms: ['regional', 'local supplier', 'wholesale supplier', 'independent distributor'],
    strategicTerms: ['distribution group', 'national distribution network', 'retail group'],
    phoneCountryCode: '+880',
    nationalPhoneLengths: [10, 11],
    preferredSocialPlatforms: ['FACEBOOK', 'LINKEDIN', 'INSTAGRAM', 'WHATSAPP'],
    officialDirectorySources: ['Bangladesh trade association', 'Bangladesh business directory'],
    pageRoleTerms: [...GENERIC.pageRoleTerms, 'trading house', 'আমাদের সম্পর্কে', 'পণ্য', 'যোগাযোগ'],
    locationTerms: ['Bangladesh', 'Dhaka', 'Chattogram', 'Chittagong', 'Gazipur', 'Narayanganj'],
    businessEvidenceTerms: Object.freeze({
      importer: [...GENERIC.businessEvidenceTerms.importer, 'আমদানিকারক'],
      wholesaler: [...GENERIC.businessEvidenceTerms.wholesaler, 'পাইকারি', 'পাইকার'],
      distributor: [...GENERIC.businessEvidenceTerms.distributor, 'পরিবেশক'],
      trading: [...GENERIC.businessEvidenceTerms.trading, 'বাণিজ্যিক'],
      company: [...GENERIC.businessEvidenceTerms.company, 'কোম্পানি', 'প্রতিষ্ঠান']
    })
  }),
  MX: Object.freeze({
    ...GENERIC,
    profileKey: 'MX',
    countryCode: 'MX',
    countryName: 'Mexico',
    providerCountryName: 'mexico',
    defaultLanguage: 'es',
    secondaryLanguages: ['en'],
    searchMarketNames: ['Mexico', 'México'],
    businessSuffixes: [
      'S.A. de C.V.', 'SA de CV', 'S. de R.L. de C.V.', 'S de RL de CV',
      'S.A.P.I. de C.V.', 'SAPI de CV', 'S.C.', 'A.C.', 'S.A.', 'Ltd', 'Limited'
    ],
    importerTerms: ['importador', 'empresa importadora', 'importer'],
    wholesalerTerms: ['mayorista', 'distribuidor mayorista', 'wholesaler'],
    distributorTerms: ['distribuidor', 'empresa distribuidora', 'distributor'],
    tradingTerms: ['comercializadora', 'empresa comercial', 'trading company'],
    retailTerms: ['cadena minorista', 'cadena de tiendas', 'retail chain'],
    departmentStoreTerms: ['tienda departamental', 'almacenes departamentales', 'department store'],
    supermarketTerms: ['cadena de supermercados', 'supermercado', 'supermarket chain'],
    smeTerms: ['regional', 'proveedor mayorista independiente', 'distribuidor local'],
    strategicTerms: ['cadena regional minorista', 'grupo de distribución', 'grupo minorista'],
    phoneCountryCode: '+52',
    nationalPhonePrefix: '',
    nationalPhoneLengths: [10],
    allowNationalWithoutPrefix: true,
    preferredSocialPlatforms: ['LINKEDIN', 'FACEBOOK', 'INSTAGRAM', 'WHATSAPP'],
    officialDirectorySources: ['Mexico business directory', 'SIEM'],
    directoryDomains: [...GENERIC.directoryDomains, 'siem.economia.gob.mx', 'seccionamarilla.com.mx'],
    newsDomains: [...GENERIC.newsDomains, 'elfinanciero.com.mx', 'eleconomista.com.mx'],
    pageRoleTerms: [...GENERIC.pageRoleTerms, 'nosotros', 'empresa', 'productos', 'marcas', 'mayoreo', 'distribución', 'contacto'],
    decisionMakerTerms: [...GENERIC.decisionMakerTerms, 'comprador', 'compras', 'gerente de compras', 'director de compras', 'abastecimiento', 'adquisiciones'],
    procurementDepartmentTerms: [...GENERIC.procurementDepartmentTerms, 'departamento de compras', 'equipo de compras', 'departamento de adquisiciones', 'área de abastecimiento'],
    supplierAccessTerms: [...GENERIC.supplierAccessTerms, 'registro de proveedores', 'alta de proveedores', 'quiero ser proveedor', 'portal de proveedores', 'licitación', 'proveedores aprobados', 'requisitos de proveedor'],
    supplierBarrierTerms: [...GENERIC.supplierBarrierTerms, 'solo por invitación', 'proveedores exclusivos', 'lista cerrada de proveedores', 'abastecimiento local', 'precalificación requerida'],
    productDiscoveryTerms: Object.freeze({
      WOMENSWEAR: ['ropa de mujer', 'vestidos', 'blusas', 'faldas', 'moda femenina'],
      GENERAL_MERCHANDISE: ['hogar', 'artículos para el hogar', 'mascotas', 'categorías', 'marcas']
    }),
    categoryBuyerDiscoveryTerms: Object.freeze({
      WOMENSWEAR: Object.freeze({
        category: ['ropa de mujer', 'vestidos', 'marcas mujer'],
        directBuyer: ['tiendas', 'cadena minorista', 'departamento de compras'],
        distribution: ['mayorista', 'distribuidor', 'importador', 'almacén', 'red de distribuidores'],
        exclusion: ['agente de compras', 'corredor', 'fabricante OEM']
      }),
      GENERAL_MERCHANDISE: Object.freeze({
        category: ['hogar', 'artículos para el hogar', 'mascotas', 'marcas'],
        directBuyer: ['tiendas', 'cadena minorista', 'departamento de compras'],
        distribution: ['mayorista', 'distribuidor', 'importador', 'almacén', 'red de distribuidores'],
        exclusion: ['agente de compras', 'corredor', 'fabricante OEM']
      })
    }),
    locationTerms: ['Mexico', 'México', 'Mexico City', 'Ciudad de México', 'CDMX', 'Guadalajara', 'Monterrey'],
    businessEvidenceTerms: Object.freeze({
      importer: [...GENERIC.businessEvidenceTerms.importer, 'importador', 'importadora', 'importación'],
      wholesaler: [...GENERIC.businessEvidenceTerms.wholesaler, 'mayorista', 'mayoreo'],
      distributor: [...GENERIC.businessEvidenceTerms.distributor, 'distribuidor', 'distribuidora', 'distribución'],
      trading: [...GENERIC.businessEvidenceTerms.trading, 'comercializadora', 'empresa comercial'],
      company: [...GENERIC.businessEvidenceTerms.company, 'empresa', 'compañía', 'productos']
    })
  })
});

function normalizeCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : 'XX';
}

export function getMarketProfile(countryCode, countryName = '') {
  const code = normalizeCode(countryCode);
  const name = String(countryName || '').trim();
  const nameKey = name.toLocaleLowerCase('en');
  const inferred = Object.values(PROFILES).find(profile =>
    [profile.countryName, ...profile.searchMarketNames].some(value => value.toLocaleLowerCase('en') === nameKey));
  const found = PROFILES[code] || (code === 'XX' ? inferred : null);
  if (found) return found;
  return Object.freeze({
    ...GENERIC,
    countryCode: code,
    countryName: name,
    providerCountryName: name.toLocaleLowerCase('en'),
    searchMarketNames: name ? [name] : []
  });
}

export function marketProfileForJob(job = {}) {
  const countryName = job.country_name || job.country || '';
  return getMarketProfile(job.country_code, countryName);
}

export function listConfiguredMarkets() {
  return [PROFILES.AE, PROFILES.MX, PROFILES.BD].map(profile => ({
    country_code: profile.countryCode,
    country_name: profile.countryName,
    default_language: profile.defaultLanguage,
    market_profile: profile.profileKey
  }));
}

export function marketLocationText(job, profile = marketProfileForJob(job)) {
  const values = [job.city, job.region, profile.searchMarketNames[0] || profile.countryName || job.country_name || job.country]
    .map(value => String(value || '').trim()).filter(Boolean);
  return [...new Set(values.map(value => value.toLocaleLowerCase('en')))]
    .map(key => values.find(value => value.toLocaleLowerCase('en') === key)).join(' ');
}

export function marketProviderLocationName(job, profile = marketProfileForJob(job)) {
  const values = [job.city, job.region, profile.countryName || job.country_name || job.country]
    .map(value => String(value || '').trim()).filter(Boolean);
  return [...new Set(values.map(value => value.toLocaleLowerCase('en')))]
    .map(key => values.find(value => value.toLocaleLowerCase('en') === key)).join(',');
}

export function marketSearchLanguage(job, profile = marketProfileForJob(job)) {
  return String(job.preferred_language || profile.defaultLanguage || 'en').trim().toLowerCase();
}

export { GENERIC as GENERIC_MARKET_PROFILE };
