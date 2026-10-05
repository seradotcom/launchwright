// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { applicationContext, dispatchApplication } from '@semwright/native-sdk';
import { execute } from '../src/application.mjs';
import { GODOT_RUNTIME_CONTRACT } from '../src/source-profiles.mjs';
import { SourcesNativeApplication } from '../src/native-sources-app.mjs';
import { nativeDriverName } from '../src/native-profile-base.mjs';
import { setup, baseline } from './helpers.mjs';

const runtime=()=>({
  semwright_sha:GODOT_RUNTIME_CONTRACT.semwright_sha,
  driver_version:GODOT_RUNTIME_CONTRACT.driver_version,
  engine_version:GODOT_RUNTIME_CONTRACT.engine_version,
  engine_sha256:GODOT_RUNTIME_CONTRACT.engine_sha256
});

async function godotSource(b,overrides={}){
  return b.create('source',{
    product_id:b.product.id,name:'Owned Godot project',type:'godot',
    locator:'godot://project/launchwright-lab',build:b.release.data.build,coverage:'declared',
    purpose:'Owned real-engine release validation',approval:'approved',...overrides
  });
}

test('RS-PRO-02 Godot preflight stays unready until the canonical runtime pin and authority are declared',async t=>{
  const {app}=setup(t),b=await baseline(app),source=await godotSource(b);
  const preflight=await execute(app,'profile.preflight',{profile:'godot',source_id:source.id,target_id:b.target.id});
  assert.equal(preflight.contract.driver.driver_id,'godot');
  assert.equal(preflight.contract.driver.semwright_sha,GODOT_RUNTIME_CONTRACT.semwright_sha);
  assert.equal(preflight.checks.find(check=>check.name==='logical-project-locator').state,'PASS');
  assert.equal(preflight.checks.find(check=>check.name==='runtime-pin').state,'UNKNOWN');
  assert.equal(preflight.checks.find(check=>check.name==='execution-authority').state,'UNKNOWN');
  assert.equal(preflight.ready_for_native_execution,false);
});

test('Godot preflight requires exact Semwright and engine pins and a logical project locator',async t=>{
  const exact=setup(t,{capabilities:{profile_execution:{godot:'available'},profile_runtime:{godot:runtime()}}});
  let b=await baseline(exact.app),source=await godotSource(b);
  let preflight=await execute(exact.app,'profile.preflight',{profile:'godot',source_id:source.id,target_id:b.target.id});
  assert.equal(preflight.checks.find(check=>check.name==='runtime-pin').state,'PASS');
  assert.equal(preflight.ready_for_native_execution,true);

  const wrong=setup(t,{capabilities:{profile_execution:{godot:'available'},profile_runtime:{godot:{...runtime(),engine_sha256:'0'.repeat(64)}}}});
  b=await baseline(wrong.app);source=await godotSource(b,{locator:'/tmp/project'});
  preflight=await execute(wrong.app,'profile.preflight',{profile:'godot',source_id:source.id,target_id:b.target.id});
  assert.equal(preflight.checks.find(check=>check.name==='logical-project-locator').state,'FAIL');
  assert.equal(preflight.checks.find(check=>check.name==='runtime-pin').state,'FAIL');
  assert.equal(preflight.ready_for_native_execution,false);
});

test('Native SDK sources profile returns the same pinned Godot preflight contract',async t=>{
  const seeded=setup(t),b=await baseline(seeded.app),source=await godotSource(b);
  seeded.app.close();
  const native=new SourcesNativeApplication(seeded.root,{capabilities:{profile_execution:{godot:'available'},profile_runtime:{godot:runtime()}}});
  try{
    const result=await dispatchApplication(
      native,'invoke',nativeDriverName('profile.preflight'),
      {ref:'canonical-host-bound-reference',input:{profile:'godot',source_id:source.id,target_id:b.target.id}},
      applicationContext('godot-profile-read',native.store.version())
    );
    assert.equal(result.ready_for_native_execution,true);
    assert.equal(result.contract.driver.engine_version,'4.7.2');
  }finally{native.close();}
});

test('CLI profile cannot become executable by falling back to arbitrary local shell authority',async t=>{
  const {app}=setup(t,{capabilities:{profile_execution:{cli:'available'}}}),b=await baseline(app);
  const source=await b.create('source',{
    product_id:b.product.id,name:'Synthetic CLI declaration',type:'cli',locator:'cli://fixture',
    build:b.release.data.build,coverage:'declared',purpose:'Owned CLI fixture',approval:'approved'
  });
  const preflight=await execute(app,'profile.preflight',{profile:'cli',source_id:source.id,target_id:b.target.id});
  assert.equal(preflight.checks.find(check=>check.name==='execution-authority').state,'PASS');
  assert.equal(preflight.checks.find(check=>check.name==='canonical-runtime').state,'FAIL');
  assert.equal(preflight.ready_for_native_execution,false);
});
