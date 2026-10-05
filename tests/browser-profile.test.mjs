// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { applicationContext, dispatchApplication } from '@semwright/native-sdk';
import { execute } from '../src/application.mjs';
import { BROWSER_RUNTIME_CONTRACT } from '../src/source-profiles.mjs';
import { SourcesNativeApplication } from '../src/native-sources-app.mjs';
import { nativeDriverName } from '../src/native-profile-base.mjs';
import { setup, baseline } from './helpers.mjs';

const runtime=(overrides={})=>({
  semwright_sha:BROWSER_RUNTIME_CONTRACT.semwright_sha,
  provider_id:BROWSER_RUNTIME_CONTRACT.provider_id,
  executable_sha256:'b'.repeat(64),
  ...overrides
});

async function browserSource(b,overrides={}){
  return b.create('source',{
    product_id:b.product.id,name:'Owned DeltaDesk web fixture',type:'web',
    locator:'http://127.0.0.1:4399/build-a/login',build:b.release.data.build,coverage:'declared',
    purpose:'Owned real browser acceptance',approval:'approved',...overrides
  });
}

test('browser preflight stays unready until exact Semwright runtime authority and executable digest are declared',async t=>{
  const {app}=setup(t),b=await baseline(app),source=await browserSource(b);
  const preflight=await execute(app,'profile.preflight',{profile:'browser',source_id:source.id,target_id:b.target.id});
  assert.equal(preflight.contract.driver.provider_id,'chromium');
  assert.equal(preflight.contract.driver.semwright_sha,BROWSER_RUNTIME_CONTRACT.semwright_sha);
  assert.equal(preflight.checks.find(check=>check.name==='source-locator').state,'PASS');
  assert.equal(preflight.checks.find(check=>check.name==='runtime-pin').state,'UNKNOWN');
  assert.equal(preflight.checks.find(check=>check.name==='runtime-executable-digest').state,'UNKNOWN');
  assert.equal(preflight.ready_for_native_execution,false);
});

test('browser preflight accepts exact pinned Semwright provider declaration and rejects malformed authority',async t=>{
  const exact=setup(t,{capabilities:{profile_execution:{browser:'available'},profile_runtime:{browser:runtime()}}});
  let b=await baseline(exact.app),source=await browserSource(b);
  let preflight=await execute(exact.app,'profile.preflight',{profile:'browser',source_id:source.id,target_id:b.target.id});
  assert.ok(preflight.checks.every(check=>check.state==='PASS'));
  assert.equal(preflight.ready_for_native_execution,true);

  const wrong=setup(t,{capabilities:{profile_execution:{browser:'available'},profile_runtime:{browser:runtime({semwright_sha:'0'.repeat(40),executable_sha256:'not-a-digest'})}}});
  b=await baseline(wrong.app);source=await browserSource(b,{locator:'file:///tmp/fake.html'});
  preflight=await execute(wrong.app,'profile.preflight',{profile:'browser',source_id:source.id,target_id:b.target.id});
  assert.equal(preflight.checks.find(check=>check.name==='source-locator').state,'FAIL');
  assert.equal(preflight.checks.find(check=>check.name==='runtime-pin').state,'FAIL');
  assert.equal(preflight.checks.find(check=>check.name==='runtime-executable-digest').state,'FAIL');
  assert.equal(preflight.ready_for_native_execution,false);
});

test('Native SDK sources profile returns the same browser preflight contract',async t=>{
  const seeded=setup(t),b=await baseline(seeded.app),source=await browserSource(b);
  seeded.app.close();
  const native=new SourcesNativeApplication(seeded.root,{capabilities:{profile_execution:{browser:'available'},profile_runtime:{browser:runtime()}}});
  try{
    const result=await dispatchApplication(
      native,'invoke',nativeDriverName('profile.preflight'),
      {ref:'canonical-host-bound-reference',input:{profile:'browser',source_id:source.id,target_id:b.target.id}},
      applicationContext('browser-profile-read',native.store.version())
    );
    assert.equal(result.ready_for_native_execution,true);
    assert.equal(result.contract.driver.provider_id,'chromium');
  }finally{native.close();}
});
