// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { rmSync } from 'node:fs';
import { LaunchwrightApplication, execute } from '../src/application.mjs';
import { exportWorkspace, restoreWorkspace } from '../src/portable.mjs';
import { setup, baseline, update } from './helpers.mjs';

test('history keeps exact entity revisions and survives a portable restore', async t=>{
  const {app,root}=setup(t),b=await baseline(app);
  const changed=(await update(app,b.product,{description:'Owned test data, revised.'})).entity;
  const history=await execute(app,'history.list',{id:b.product.id});
  assert.deepEqual(history.items.map(v=>v.version.revision),['1','2']);
  const diff=await execute(app,'history.diff',{id:b.product.id,from_revision:'1',to_revision:'2'});
  assert.deepEqual(diff.changed_fields,['description']);
  assert.equal(diff.before.description,'Owned test data');
  assert.equal(diff.after.description,'Owned test data, revised.');
  const exact=await execute(app,'history.get',{id:b.product.id,revision:'2'});
  assert.deepEqual(exact.version,changed.version);

  const exported=exportWorkspace(app);
  assert.ok(exported.manifest.history.length>exported.manifest.entities.length);
  const restored=join(dirname(root),'launchwright-history-'+randomUUID());
  t.after(()=>rmSync(restored,{recursive:true,force:true}));
  restoreWorkspace(exported.bytes,restored,{commit:true});
  const reopened=new LaunchwrightApplication(restored,{readOnly:true});
  t.after(()=>reopened.close());
  const restoredHistory=await execute(reopened,'history.list',{id:b.product.id});
  assert.deepEqual(restoredHistory.items.map(v=>v.version.revision),['1','2']);
});

test('document ownership, expected-base proposals and document pins prevent silent overwrite', async t=>{
  const {app}=setup(t),b=await baseline(app);
  let document=(await execute(app,'document.create',{
    release_id:b.release.id,name:'Install guide',target_id:b.target.id,locale:'en-US',branch_mode:'rolling',format:'markdown',
    external_base:{system:'git',locator:'docs/install.md',revision:'base-1'},
    sections:[
      {id:'human_notes',title:'Operator notes',owner:'human',blocks:[{id:'human_intro',kind:'paragraph',owner:'human',content:'Keep my wording.'}]},
      {id:'managed_steps',title:'Managed steps',owner:'managed',blocks:[{id:'managed_install',kind:'instruction',owner:'managed',content:'Install build A.',source_ids:[b.source.id]}]},
    ],
  })).entity;
  document=(await execute(app,'document.edit_human',{id:document.id,expected:document.version,block_id:'human_intro',content:'Keep my revised wording.'})).entity;
  await assert.rejects(execute(app,'document.propose',{id:document.id,expected:document.version,changes:[{block_id:'human_intro',content:'Overwrite human text.'}]}),err=>err?.code==='PermissionDenied');

  const proposal=(await execute(app,'document.propose',{
    id:document.id,expected:document.version,reason:'Update only managed release text.',
    changes:[{block_id:'managed_install',content:'Install build A from the approved source.'}],
  })).entity;
  await assert.rejects(execute(app,'document.resolve',{
    proposal_id:proposal.id,decision:'approve',expected_document:document.version,comment:'Approve managed update.',observed_external_revision:'base-2',
  }),err=>err?.code==='StaleReference');
  document=(await execute(app,'document.resolve',{
    proposal_id:proposal.id,decision:'approve',expected_document:document.version,comment:'Approve managed update.',observed_external_revision:'base-1',
  })).entity;
  assert.equal(document.data.sections[0].blocks[0].content,'Keep my revised wording.');
  assert.equal(document.data.sections[1].blocks[0].content,'Install build A from the approved source.');
  const inspected=await execute(app,'document.inspect',{id:document.id});
  assert.equal(inspected.proposals.find(v=>v.id===proposal.id).data.state,'APPLIED');
  assert.equal(inspected.automatic_human_overwrite,false);

  const rendered=await execute(app,'document.render',{id:document.id});
  assert.ok(rendered.entity.data.inputs.some(v=>v.id===document.id&&v.version.revision===document.version.revision));
  await execute(app,'candidate.freeze',{
    release_id:b.release.id,name:'Guide candidate',artifact_ids:[rendered.entity.id],destination:'guide-draft',
    contract:{version:'docs-v1',required_reviewers:1,require_claims_verified:false},
  });
  document=(await execute(app,'document.edit_human',{id:document.id,expected:document.version,block_id:'human_intro',content:'A later human edit.'})).entity;
  await assert.rejects(execute(app,'candidate.freeze',{
    release_id:b.release.id,name:'Stale guide candidate',artifact_ids:[rendered.entity.id],destination:'guide-stale',
    contract:{version:'docs-v1',required_reviewers:1,require_claims_verified:false},
  }),err=>err?.code==='StaleReference');
});

test('RTL structured HTML renders direction explicitly without executing imported content', async t=>{
  const {app}=setup(t),b=await baseline(app);
  const ar=(await b.create('target',{release_id:b.release.id,name:'Arabic target',ui_locale:'ar',editorial_locale:'ar',role:'viewer',plan:'basic',region:'SA',flags:{},viewport:{width:1280,height:900,scale_milli:1000}}));
  const document=(await execute(app,'document.create',{
    release_id:b.release.id,name:'Arabic notes',target_id:ar.id,locale:'ar',branch_mode:'rolling',format:'html',
    sections:[{id:'body',title:'ملاحظات',owner:'human',blocks:[{id:'intro',kind:'paragraph',owner:'human',content:'<script>never()</script> نص آمن'}]}],
  })).entity;
  const rendered=await execute(app,'document.render',{id:document.id});
  const html=app.store.readBlob(rendered.entity.data.sha256).bytes.toString('utf8');
  assert.match(html,/dir="rtl"/);
  assert.ok(html.includes('&lt;script&gt;never()&lt;/script&gt;'));
  assert.ok(!html.includes('<script>never()</script>'));
});

test('translation requires human semantic review and becomes stale when glossary changes', async t=>{
  const {app}=setup(t),b=await baseline(app);
  const source=(await b.create('deliverable',{release_id:b.release.id,name:'Safety note',target_id:b.target.id,format:'markdown',content:'Do not exceed 10 kg.',claim_ids:[],source_ids:[b.source.id]}));
  const es=(await b.create('target',{release_id:b.release.id,name:'Spanish target',ui_locale:'es-MX',editorial_locale:'es-MX',role:'viewer',plan:'basic',region:'MX',flags:{},viewport:{width:1280,height:800,scale_milli:1000}}));
  let glossary=(await b.create('glossary',{product_id:b.product.id,name:'Product terminology',source_locale:'en-US',target_locale:'es-MX',terms:[{source:'Do not exceed',target:'No exceda'}],fallback_policy:'block',reviewed_at:'2026-10-05T00:00:00.000Z'}));
  const font=(await b.create('font_profile',{product_id:b.product.id,name:'System font policy',profile_version:'1',locales:['es-MX'],font_family_ref:'system-ui',coverage:'declared',rights:'owned',license_ref:'system-font-policy',asset_included:false,reviewed_at:'2026-10-05T00:00:00.000Z'}));
  let translation=(await execute(app,'translation.create',{source_id:source.id,target_id:es.id,glossary_id:glossary.id,font_profile_id:font.id,name:'Nota de seguridad',text:'No exceda.',origin:'machine'})).entity;
  let inspected=await execute(app,'translation.inspect',{id:translation.id});
  assert.equal(inspected.risk.requires_human_semantic_review,true);
  assert.ok(inspected.risk.missing_tokens.includes('10'));

  await assert.rejects(execute(app,'translation.review',{id:translation.id,expected:translation.version,decision:'approve',comment:'Looks reasonable.'}),err=>err?.code==='ConsentRequired');
  translation=(await execute(app,'translation.review',{id:translation.id,expected:translation.version,decision:'approve',comment:'Numbers, units and negation checked against the source.',risk_acknowledgement:'human-semantic-review'})).entity;
  assert.equal(translation.data.semantic_verification,'HUMAN_REVIEWED');
  const rendered=await execute(app,'translation.render',{id:translation.id});
  assert.ok(rendered.entity.data.inputs.some(v=>v.id===glossary.id&&v.version.revision===glossary.version.revision));

  glossary=(await update(app,glossary,{terms:[{source:'Do not exceed',target:'No supere'}]})).entity;
  inspected=await execute(app,'translation.inspect',{id:translation.id});
  assert.equal(inspected.computed_state,'STALE_SOURCE');
  assert.equal(inspected.translation.data.text,'No exceda.');
  assert.equal(inspected.automatic_fallback,false);
  const rebased=await execute(app,'translation.rebase',{id:translation.id,expected:translation.version});
  translation=rebased.entity;
  assert.equal(rebased.preserved_text,true);
  assert.equal(translation.data.text,'No exceda.');
  assert.equal(translation.data.state,'HUMAN_EDITED');
  inspected=await execute(app,'translation.inspect',{id:translation.id});
  assert.equal(inspected.computed_state,'HUMAN_EDITED');
  assert.equal(inspected.semantic_verification,'PENDING_HUMAN_REVIEW');
  await assert.rejects(execute(app,'candidate.freeze',{
    release_id:b.release.id,name:'Stale translation',artifact_ids:[rendered.entity.id],destination:'translated-stale',
    contract:{version:'loc-v1',required_reviewers:1,require_claims_verified:false},
  }),err=>err?.code==='StaleReference');
});

test('declarative extension registry negotiates versions without loading descriptor code', async t=>{
  const {app}=setup(t);
  const descriptor={
    name:'Synthetic renderer contract',type:'renderer',contract_version:'1.2.0',
    package:{name:'example-renderer',version:'1.2.3',sha256:'a'.repeat(64),license:'MIT',source:'https://example.invalid/renderer'},
    permissions:['read-artifacts','write-draft'],inputs:['document'],outputs:['artifact'],transformation:'Render an owned synthetic document into an alternate text artifact.',
    preconditions:['source-current'],evidence:['sha256'],compatibility:{app_schema_versions:['launchwright/1'],notes:'Synthetic contract only.'},
    limits:{max_input_bytes:1048576,max_output_bytes:1048576,timeout_seconds:30},
    descriptor:{summary:'Declarative renderer metadata.',properties:[{name:'quality',type:'enum',required:false}],actions:['render.preview']},
  };
  let extension=(await execute(app,'extension.register',descriptor)).entity;
  const shown=await execute(app,'extension.describe',{id:extension.id});
  assert.equal(shown.code_execution,'NOT_FROM_DESCRIPTOR');
  assert.equal(shown.package_bytes_embedded,false);
  assert.equal((await execute(app,'extension.negotiate',{id:extension.id,contract_version:'1.9.0',app_schema_version:'launchwright/1'})).status,'SUPPORTED');
  assert.equal((await execute(app,'extension.negotiate',{id:extension.id,contract_version:'2.0.0',app_schema_version:'launchwright/1'})).status,'UNSUPPORTED');

  await assert.rejects(execute(app,'extension.register',{
    ...descriptor,package:{...descriptor.package,name:'unsafe-renderer',sha256:'b'.repeat(64)},
    descriptor:{...descriptor.descriptor,summary:'<script>alert(1)</script>'},
  }));
  extension=(await execute(app,'extension.retire',{id:extension.id,expected:extension.version,reason:'Replace with a later reviewed contract.'})).entity;
  assert.equal(extension.data.state,'RETIRED');
  assert.equal((await execute(app,'extension.negotiate',{id:extension.id,contract_version:'1.2.0',app_schema_version:'launchwright/1'})).status,'RETIRED');
  const history=await execute(app,'history.list',{id:extension.id});
  assert.deepEqual(history.items.map(v=>v.version.revision),['1','2']);
});

test('schema negotiation rejects incompatible clients instead of reinterpreting their operations', async t=>{
  const {app}=setup(t);
  const supported=await execute(app,'workspace.negotiate',{schema_version:'launchwright/1',operations:['document.create','unknown.future']});
  assert.equal(supported.status,'SUPPORTED');
  assert.deepEqual(supported.supported_operations,['document.create']);
  assert.deepEqual(supported.unsupported_operations,['unknown.future']);
  const incompatible=await execute(app,'workspace.negotiate',{schema_version:'launchwright/2',operations:['document.create']});
  assert.equal(incompatible.status,'UNSUPPORTED_MAJOR');
  assert.equal(incompatible.compatible,false);
  assert.equal(incompatible.interpretation,'exact-no-coercion');
});

test('legacy workspace history migration backfills only current state and does not invent prior revisions', async t=>{
  const {app}=setup(t),b=await baseline(app);
  app.store.db.exec('DROP TABLE entity_history; DROP TABLE app_extensions;');
  app.store.hasHistory=false;
  await assert.rejects(update(app,b.product,{description:'Must not mutate before migration.'}),err=>err?.code==='ProtocolMismatch');
  const migration=app.store.installHistory();
  assert.equal(migration.pre_migration_history,'NOT_RECONSTRUCTED');
  assert.equal(migration.installed,true);
  const before=await execute(app,'history.list',{id:b.product.id});
  assert.deepEqual(before.items.map(v=>v.version.revision),['1']);
  const changed=(await update(app,b.product,{description:'First post-migration revision.'})).entity;
  const after=await execute(app,'history.list',{id:b.product.id});
  assert.deepEqual(after.items.map(v=>v.version.revision),['1','2']);
  assert.equal(changed.data.description,'First post-migration revision.');
  const doctor=await execute(app,'workspace.doctor',{});
  assert.equal(doctor.history_ready,true);
  assert.equal(doctor.repairs_performed,false);
});
