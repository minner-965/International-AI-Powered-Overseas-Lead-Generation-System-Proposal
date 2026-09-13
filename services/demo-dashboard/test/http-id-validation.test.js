import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDetailId} from '../src/httpIdValidation.js';
import {validateCategoryScopeDraft,CategoryScopeService} from '../src/categoryProcurement/CategoryScopeService.js';

test('detail UUID validation rejects malformed identifiers without reflecting input',()=>{
  for(const value of ['invalid','1',"' OR true --",'00000000-0000-0000-0000-00000000000Z']) {
    let status,body,next=false;
    const res={status(n){status=n;return this;},json(value){body=value;}};
    validateDetailId({method:'GET'},res,()=>{next=true;},value);
    assert.equal(status,400);assert.equal(body.code,'INVALID_RECORD_ID');assert.equal(next,false);
    assert.equal(body.error,'Invalid record identifier');
  }
});
test('detail UUID validation accepts UUID shape without imposing version restrictions',()=>{
  for(const value of ['00000000-0000-0000-0000-000000000000','ABCDEFAB-1234-5678-9012-123456789ABC']) {
    let next=false;validateDetailId({method:'GET'},{},()=>{next=true;},value);assert.equal(next,true);
  }
});
test('write routes retain their existing authentication and input validation order',()=>{
  let next=false;validateDetailId({method:'POST'},{},()=>{next=true;},'invalid');assert.equal(next,true);
});
test('category input errors declare client status without disguising infrastructure failures',()=>{
  assert.throws(()=>validateCategoryScopeDraft({}),error=>error.code==='CATEGORY_SCOPE_FACTS_REQUIRED'&&error.status===400);
  assert.throws(()=>new CategoryScopeService(),error=>error.status===undefined);
});
