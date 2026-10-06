// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { execute } from '../src/application.mjs';
import { BROWSER_RUNTIME_CONTRACT } from '../src/source-profiles.mjs';
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
  const {app:authorized}=setup(t,{capabilities:{profile_execution:{browser:'available'},profile_runtime:{browser:{semwright_sha:BROWSER_RUNTIME_CONTRACT.semwright_sha,provider_id:BROWSER_RUNTIME_CONTRACT.provider_id,executable_sha256:'b'.repeat(64)}}}});b=await baseline(authorized);
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


test('generic extension view preserves package rights and refuses false renderer equivalence', async t=>{
  const {app}=setup(t);
  const renderer={name:'Synthetic diagram renderer',type:'deliverable_renderer',package_version:'3.1.0',schema_major:1,digest:'e'.repeat(64),license:'Apache-2.0',source:'repo:synthetic/diagram-renderer',permissions:['read','edit'],inputs:['diagram-model/1'],outputs:['svg-artifact/1'],preconditions:['typed-model'],evidence:['fidelity-report'],limits:{max_input_bytes:8192,max_output_bytes:65536,timeout_seconds:20},
    renderer:{fidelity:'bounded-loss',equivalent:false,preserved_relations:['parent-child'],lost_relations:['camera-depth'],constraints:['2d-only']},
    rights:{owner:'Synthetic fixture',package_license:'Apache-2.0',redistribution:'metadata-only',notices:['Synthetic package notice'],third_party:[{name:'Synthetic font metadata',license:'OFL-1.1',source:'https://example.invalid/font',redistribution:'forbidden',notice:'Metadata only; bytes are not bundled.'}]},
    namespaces:{'example.renderer':{quality:'bounded',units:'px'}}};
  const ext=(await execute(app,'extension.register',renderer)).entity;
  const discovery=await execute(app,'extension.discovery',{});
  assert.equal(discovery.schema_version,'launchwright-extension-discovery/2');
  const view=discovery.items.find(item=>item.id===ext.id);
  assert.equal(view.presentation_code_executable,false);
  assert.equal(view.authority_grants_from_descriptor,false);
  assert.equal(view.renderer.equivalent,false);
  assert.deepEqual(view.renderer.lost_relations,['camera-depth']);
  assert.equal(view.rights.redistribution,'metadata-only');
  assert.equal(view.rights.third_party[0].redistribution,'forbidden');
  assert.deepEqual(view.properties.namespaces['example.renderer'],{quality:'bounded',units:'px'});
  await assert.rejects(execute(app,'extension.register',{...renderer,name:'False exact renderer',package_version:'3.1.1',digest:'f'.repeat(64),renderer:{fidelity:'exact',equivalent:true,preserved_relations:[],lost_relations:['required-relation'],constraints:[]}}),/cannot claim equivalence/i);
  await assert.rejects(execute(app,'extension.register',{...renderer,name:'Executable descriptor',package_version:'3.1.2',digest:'1'.repeat(64),namespaces:{'example.renderer':{html:'<script>alert(1)</script>'}}}),/presentation code/i);
});

test('retirement identifies affected locks, blocks reuse and preserves historical lock evidence', async t=>{
  const {app}=setup(t);const b=await baseline(app);
  const manifest={name:'Synthetic git source',type:'source_adapter',package_version:'1.0.0',schema_major:1,digest:'2'.repeat(64),license:'MIT',source:'repo:synthetic/git-source',permissions:['read','capture'],inputs:['git-tree/1'],outputs:['source-observation/1'],preconditions:['repository-readable'],evidence:['tree-digest'],limits:{max_input_bytes:4096,max_output_bytes:4096,timeout_seconds:10},rights:{package_license:'MIT',redistribution:'metadata-only',notices:[],third_party:[]}};
  const ext=(await execute(app,'extension.register',manifest)).entity;
  const lock=(await execute(app,'compatibility.lock',{product_id:b.product.id,name:'Git source lock',components:[{kind:'source-adapter',name:ext.data.name,version:ext.data.package_version,digest:ext.data.digest,resource_id:ext.id}],notes:'Non-DOM source adapter rehearsal'})).entity;
  const retired=await execute(app,'extension.retire',{id:ext.id,expected:ext.version,reason:'Revoked synthetic package'});
  assert.deepEqual(retired.affected_compatibility_lock_ids,[lock.id]);
  assert.equal(retired.prior_attempts_preserved,true);
  assert.equal(retired.automatic_rerun,false);
  const historical=await execute(app,'resource.get',{id:lock.id});
  assert.equal(historical.id,lock.id);
  const inspected=await execute(app,'compatibility.inspect',{id:lock.id});
  assert.equal(inspected.state,'DRIFT');
  assert.equal(inspected.components[0].state,'RETIRED');
  await assert.rejects(execute(app,'compatibility.lock',{product_id:b.product.id,name:'Forbidden reuse',components:[{kind:'source-adapter',name:ext.data.name,version:ext.data.package_version,digest:ext.data.digest,resource_id:ext.id}]}),/retired extension/i);
});

test('compatibility rehearsal records change without inheriting prior PASS evidence', async t=>{
  const {app}=setup(t);const b=await baseline(app);
  const base={name:'Synthetic channel adapter',type:'channel_adapter',schema_major:1,license:'AGPL-3.0-only',source:'repo:synthetic/channel',permissions:['publish'],inputs:['candidate/1'],outputs:['receipt/1'],preconditions:['consent'],evidence:['receipt'],limits:{max_input_bytes:4096,max_output_bytes:4096,timeout_seconds:10}};
  const v1=(await execute(app,'extension.register',{...base,package_version:'1.0.0',digest:'3'.repeat(64)})).entity;
  const v2=(await execute(app,'extension.register',{...base,package_version:'2.0.0',digest:'4'.repeat(64)})).entity;
  const first=(await execute(app,'compatibility.lock',{product_id:b.product.id,name:'Channel toolchain v1',components:[{kind:'channel-adapter',name:base.name,version:v1.data.package_version,digest:v1.data.digest,resource_id:v1.id}]})).entity;
  const next=(await execute(app,'compatibility.lock',{product_id:b.product.id,name:'Channel toolchain v2 rehearsal',rehearsal_of_id:first.id,components:[{kind:'channel-adapter',name:base.name,version:v2.data.package_version,digest:v2.data.digest,resource_id:v2.id}],notes:'Explicit upgrade rehearsal'})).entity;
  assert.equal(next.data.rehearsal.from_lock_id,first.id);
  assert.equal(next.data.rehearsal.previous_state,'CURRENT');
  assert.equal(next.data.rehearsal.evidence_reused,false);
  assert.deepEqual(next.data.rehearsal.inherited_passes,[]);
  assert.equal(next.data.rehearsal.state,'REQUIRES_REVIEW');
  assert.equal(next.data.rehearsal.changed_components.length,1);
  const negotiation=await execute(app,'compatibility.negotiate',{schema_major:1,operations:['future.operation'],kinds:['future_kind']});
  assert.equal(negotiation.compatible,true);
  assert.deepEqual(negotiation.diagnostics.map(x=>x.code),['OPERATION_UNSUPPORTED','KIND_UNSUPPORTED']);
});
