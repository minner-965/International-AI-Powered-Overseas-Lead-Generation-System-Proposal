import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import vm from 'node:vm';
import {searchCountryCode} from '../src/market/searchCountryCode.js';
import {FrozenSearchPlanExecutor} from '../src/search/FrozenSearchPlanExecutor.js';
import {createConfiguredSearchProvider} from '../src/search/SearchProviderRouter.js';

test('retired synchronous discovery and hardcoded strategy modules are absent',()=>{
  for(const name of ['discoveryService.js','queryGenerator.js'])
    assert.equal(existsSync(new URL(`../src/search/${name}`,import.meta.url)),false);
  const executor=readFileSync(new URL('../src/search/FrozenSearchPlanExecutor.js',import.meta.url),'utf8');
  assert.doesNotMatch(executor,/generateResearchQueries|discoverResearchCandidates/);
});

test('frozen discovery rejects a missing plan without selecting or calling providers',async()=>{
  let selections=0;
  const executor=new FrozenSearchPlanExecutor({store:{load:async()=>null},router:{select:async()=>{selections++;}}});
  await assert.rejects(executor.executeJob('fixture'),{code:'PERSISTED_SEARCH_PLAN_REQUIRED'});
  assert.equal(selections,0);
});

test('country conversion remains available without a legacy query generator',()=>{
  assert.equal(searchCountryCode('Mexico'),'MX');
  assert.equal(searchCountryCode('United Arab Emirates'),'AE');
  assert.equal(searchCountryCode('Example Market','XX'),'ALL');
});

test('approved and configured provider adapters remain constructible without network access',()=>{
  for(const name of ['brave','tavily','dataforseo']) {
    const provider=createConfiguredSearchProvider({provider:name},{fetchImpl:()=>{throw Error('unexpected network');}});
    assert.equal(provider.name,name);
  }
});

for(const action of ['generate-queries','discover']) {
  test(`retired ${action} endpoint retains authentication and returns 410 without side effects`,()=>{
    const source=readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
    const route=`/api/internal/research/jobs/:id/${action}`;
    const start=source.indexOf(`app.post('${route}'`);
    assert.ok(start>=0);
    const end=source.indexOf('\n});',start);
    assert.ok(end>start);
    const registration=source.slice(start,end+4);
    let registered;
    let effects=0;
    const forbidden=()=>{effects++;throw Error('unexpected external or database operation');};
    const requireInternalToken=()=>{};
    const context={requireInternalToken,
      app:{post:(...args)=>{registered=args;}},
      pool:{query:forbidden,connect:forbidden},fetch:forbidden,
      persistGeneratedQueries:forbidden,discoverResearchCandidates:forbidden,
      telemetry:{withSpan:forbidden},audit:forbidden};
    vm.runInNewContext(registration,context,{timeout:1000});
    assert.equal(registered[0],route);
    assert.equal(registered[1],requireInternalToken);
    assert.equal(registered.length,3);
    let status,payload;
    const res={status(value){status=value;return this;},json(value){payload=value;return this;}};
    registered[2]({params:{id:'fixture'}},res);
    assert.equal(status,410);
    assert.equal(payload.code,'RETIRED_SEARCH_PATH');
    assert.equal(effects,0);
  });
}
