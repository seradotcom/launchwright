// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { execute } from '../src/application.mjs';
import { setup, baseline, update } from './helpers.mjs';

async function localeFixture(app){
  const b=await baseline(app);
  const claim=await b.create('claim',{release_id:b.release.id,name:'Launch claim',text:'Launch securely',target_id:b.target.id,category:'editorial',subject:'launch',scope:'release-copy',owner:'release-team',evidence_ids:[]});
  const copy=await b.create('copy_block',{release_id:b.release.id,name:'English launch copy',target_id:b.target.id,claim_id:claim.id,locale:'en-US',content:'Launch securely',owner:'human'});
  const arabic=await b.create('target',{release_id:b.release.id,name:'Arabic basic',ui_locale:'en-US',editorial_locale:'ar-SA',role:'viewer',plan:'basic',region:'MX',flags:{advanced_export:false},viewport:{width:1440,height:900,scale_milli:1000}});
  const glossary=await b.create('glossary',{product_id:b.product.id,name:'Launch terms',source_locale:'en-US',target_locale:'ar-SA',version_label:'1',terms:[{source:'Launch',target:'إطلاق',critical:true}],owner:'human',status:'active'});
  return{...b,claim,copy,arabic,glossary};
}
const localizationInput=b=>({release_id:b.release.id,target_id:b.arabic.id,source_copy_block_id:b.copy.id,glossary_id:b.glossary.id,name:'Arabic launch copy',locale:'ar-SA',direction:'rtl',fallback_policy:'block',content:'إطلاق آمن',owner:'human',status:'HUMAN_EDITED',font_refs:[]});

test('localization pins source and glossary revisions and exposes unverified layout honestly', async t=>{
  const {app}=setup(t);const b=await localeFixture(app);
  const localized=(await execute(app,'localization.create',localizationInput(b))).entity;
  const a=await execute(app,'localization.assess',{id:localized.id});
  assert.equal(a.state,'UNKNOWN');
  assert.equal(a.direction.expected,'rtl');
  assert.deepEqual(a.reasons,[]);
  assert.equal(a.final_layout_verified,false);
  assert.equal(a.professional_language_quality_verified,false);
  assert.deepEqual(localized.data.source_version,b.copy.version);
  assert.deepEqual(localized.data.glossary_version,b.glossary.version);
});

test('RTL mismatch, unresolved font rights and missing critical terminology fail closed', async t=>{
  const {app}=setup(t);const b=await localeFixture(app);
  const localized=(await execute(app,'localization.create',{...localizationInput(b),direction:'ltr',content:'نسخة آمنة',font_refs:[{family:'Private Font',rights:'unknown',coverage:'unknown'}]})).entity;
  const a=await execute(app,'localization.assess',{id:localized.id});
  assert.equal(a.state,'FAIL');
  assert.ok(a.reasons.includes('direction-mismatch'));
  assert.ok(a.reasons.includes('critical-glossary-term-missing:Launch'));
  assert.ok(a.reasons.includes('font-rights-unresolved:Private Font'));
  assert.ok(a.warnings.includes('font-coverage-unverified:Private Font'));
});

test('source edits make translation stale and explicit rebase is required', async t=>{
  const {app}=setup(t);const b=await localeFixture(app);
  let localized=(await execute(app,'localization.create',localizationInput(b))).entity;
  const changed=(await update(app,b.copy,{content:'Launch securely today'})).entity;
  const stale=await execute(app,'localization.assess',{id:localized.id});
  assert.equal(stale.state,'STALE_SOURCE');
  assert.ok(stale.reasons.includes('STALE_SOURCE'));
  const data={release_id:localized.data.release_id,target_id:localized.data.target_id,source_copy_block_id:localized.data.source_copy_block_id,glossary_id:localized.data.glossary_id,name:localized.data.name,locale:localized.data.locale,direction:localized.data.direction,fallback_policy:localized.data.fallback_policy,content:'إطلاق آمن اليوم',owner:'human',status:'HUMAN_EDITED',font_refs:[]};
  await assert.rejects(execute(app,'localization.update',{id:localized.id,expected:localized.version,data}),{code:'StaleReference'});
  localized=(await execute(app,'localization.update',{id:localized.id,expected:localized.version,data,acknowledge_rebase:true})).entity;
  assert.deepEqual(localized.data.source_version,changed.version);
  const current=await execute(app,'localization.assess',{id:localized.id});
  assert.equal(current.state,'UNKNOWN');
  assert.ok(!current.reasons.includes('STALE_SOURCE'));
});

test('localization target must preserve the source audience context', async t=>{
  const {app}=setup(t);const b=await localeFixture(app);
  const wrong=await b.create('target',{release_id:b.release.id,name:'Arabic admin',ui_locale:'en-US',editorial_locale:'ar-SA',role:'admin',plan:'basic',region:'MX',flags:{advanced_export:false},viewport:{width:1440,height:900,scale_milli:1000}});
  const localized=(await execute(app,'localization.create',{...localizationInput(b),target_id:wrong.id,name:'Wrong audience'})).entity;
  const a=await execute(app,'localization.assess',{id:localized.id});
  assert.ok(a.reasons.includes('audience-context-mismatch'));
});

test('profile preflight is contract-only and requires explicit execution capability', async t=>{
  const {app}=setup(t);let b=await baseline(app);
  const approved=(await update(app,b.source,{purpose:'Owned product capture',approval:'approved'})).entity;
  let p=await execute(app,'profile.preflight',{profile:'browser',source_id:approved.id,target_id:b.target.id});
  assert.equal(p.checks.find(c=>c.name==='source-type').state,'PASS');
  assert.equal(p.checks.find(c=>c.name==='source-purpose').state,'PASS');
  assert.equal(p.checks.find(c=>c.name==='build-match').state,'PASS');
  assert.equal(p.checks.find(c=>c.name==='execution-authority').state,'UNKNOWN');
  assert.equal(p.ready_for_native_execution,false);
  const {app:authorized}=setup(t,{capabilities:{profile_execution:{browser:'available'}}});b=await baseline(authorized);
  const source=(await update(authorized,b.source,{purpose:'Owned product capture',approval:'approved'})).entity;
  p=await execute(authorized,'profile.preflight',{profile:'browser',source_id:source.id,target_id:b.target.id});
  assert.equal(p.ready_for_native_execution,true);
  const mobile=await b.create('source',{product_id:b.product.id,name:'Imported mobile bundle',type:'mobile-import',locator:'bundle:fixture',build:'build-A',coverage:'declared'});
  p=await execute(authorized,'profile.preflight',{profile:'mobile-import',source_id:mobile.id,target_id:b.target.id});
  assert.equal(p.import_only,true);
  assert.equal(p.ready_for_native_execution,false);
});

test('extension discovery stores bounded descriptors and never turns them into executable code', async t=>{
  const {app}=setup(t);
  const manifest={name:'Synthetic source adapter',type:'source_adapter',package_version:'1.2.3',schema_major:1,digest:'c'.repeat(64),license:'AGPL-3.0-only',source:'repo:synthetic/source-adapter',permissions:['read','capture'],inputs:['source-contract/1'],outputs:['capture-receipt/1'],preconditions:['approved-source'],evidence:['operation-receipt'],limits:{max_input_bytes:4096,max_output_bytes:8192,timeout_seconds:10}};
  const ext=(await execute(app,'extension.register',manifest)).entity;
  assert.equal(ext.data.remote_code_executable,false);
  let discovery=await execute(app,'extension.discovery',{});
  assert.equal(discovery.remote_code_execution,false);
  assert.equal(discovery.platform_registry_authority,false);
  assert.equal(discovery.items.length,1);
  await assert.rejects(execute(app,'extension.register',manifest),{code:'Conflict'});
  await assert.rejects(execute(app,'extension.register',{...manifest,name:'Future schema',schema_major:2}),{code:'ProtocolMismatch'});
  await execute(app,'extension.retire',{id:ext.id,expected:ext.version,reason:'Synthetic retirement'});
  discovery=await execute(app,'extension.discovery',{});
  assert.equal(discovery.items.length,0);
  discovery=await execute(app,'extension.discovery',{include_retired:true});
  assert.equal(discovery.items[0].status,'retired');
});

test('compatibility locks detect retired extension drift and major negotiation never silently succeeds', async t=>{
  const {app}=setup(t);const b=await baseline(app);
  const ext=(await execute(app,'extension.register',{name:'Synthetic channel adapter',type:'channel_adapter',package_version:'2.0.0',schema_major:1,digest:'d'.repeat(64),license:'AGPL-3.0-only',source:'repo:synthetic/channel-adapter',permissions:['publish'],inputs:['candidate/1'],outputs:['receipt/1'],preconditions:['consent'],evidence:['external-receipt'],limits:{max_input_bytes:4096,max_output_bytes:4096,timeout_seconds:10}})).entity;
  const lock=(await execute(app,'compatibility.lock',{product_id:b.product.id,name:'Release toolchain',components:[{kind:'native-sdk',name:'@semwright/native-sdk',version:'0.9.0-dev.1'},{kind:'channel-adapter',name:ext.data.name,version:ext.data.package_version,digest:ext.data.digest,resource_id:ext.id}],notes:'Synthetic rehearsal lock'})).entity;
  let inspected=await execute(app,'compatibility.inspect',{id:lock.id});
  assert.equal(inspected.state,'CURRENT');
  assert.equal(inspected.components.find(c=>c.kind==='channel-adapter').state,'CURRENT');
  await execute(app,'extension.retire',{id:ext.id,expected:ext.version,reason:'Upgrade rehearsal'});
  inspected=await execute(app,'compatibility.inspect',{id:lock.id});
  assert.equal(inspected.state,'DRIFT');
  assert.equal(inspected.components.find(c=>c.kind==='channel-adapter').state,'RETIRED');
  const negotiation=await execute(app,'compatibility.negotiate',{schema_major:2,operations:['workspace.describe','future.operation'],kinds:['product','future_kind']});
  assert.equal(negotiation.compatible,false);
  assert.deepEqual(negotiation.unsupported_operations,['future.operation']);
  assert.deepEqual(negotiation.unsupported_kinds,['future_kind']);
  assert.equal(negotiation.major_mismatch_behavior,'reject');
});
