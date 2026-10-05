// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { execute } from '../src/application.mjs';
import { setup, baseline, update } from './helpers.mjs';

test('external source requires approved purpose before it can be registered', async t => {
  const {app}=setup(t);
  const product=(await execute(app,'entity.create',{kind:'product',data:{name:'Authorized product'}})).entity;
  const base={product_id:product.id,name:'External app',type:'web',locator:'https://example.test',build:'deploy-A',coverage:'declared'};
  await assert.rejects(execute(app,'entity.create',{kind:'source',data:base}),{code:'PermissionDenied'});
  const source=(await execute(app,'entity.create',{kind:'source',data:{...base,purpose:'Capture owned release documentation surfaces.',approval:'approved'}})).entity;
  assert.equal(source.data.approval,'approved');
});

test('build snapshot identity is distinct from release label and survives release edits', async t => {
  const {app}=setup(t);const b=await baseline(app);
  const build1=await b.create('build',{product_id:b.product.id,name:'Deployment A',artifact_digest:'a'.repeat(64),version_label:'1.0',source_revision:'commit-A'});
  const build2=await b.create('build',{product_id:b.product.id,name:'Deployment B',artifact_digest:'b'.repeat(64),version_label:'1.0',source_revision:'commit-B'});
  assert.notEqual(build1.id,build2.id);
  const release=(await update(app,b.release,{build_id:build1.id,name:'1.0 marketing name'})).entity;
  assert.equal(release.data.build_id,build1.id);
  assert.equal(release.data.build,'build-A');
});

test('declared unavailability deterministically blocks an availability claim without manufacturing PASS', async t => {
  const {app}=setup(t);const b=await baseline(app);
  const feature=await b.create('feature',{release_id:b.release.id,name:'Advanced export',key:'advanced_export',status:'active',description:'Synthetic feature'});
  const availability=await b.create('availability',{release_id:b.release.id,name:'Basic viewer access',feature_id:feature.id,target_id:b.target.id,state:'unavailable',basis:'declared'});
  const claim=await b.create('claim',{release_id:b.release.id,name:'Export availability',text:'Advanced export is available.',target_id:b.target.id,category:'availability',evidence_ids:[],subject:'advanced_export',scope:'basic viewer',owner:'release-team',availability_id:availability.id});
  const coverage=app.coverage(b.release.id);
  const check=coverage.claims.find(c=>c.claim_id===claim.id);
  assert.equal(check.status,'FAIL');
  assert.ok(check.reasons.includes('declared-availability-contradiction'));
  assert.ok(check.reasons.includes('canonical-claim-verifier-unavailable'));
  assert.equal(coverage.pass,0);
});

test('Claim changes invalidate artifacts linked through CopyBlocks even if pixels were not compared', async t => {
  const {app}=setup(t);const b=await baseline(app);
  const claim=await b.create('claim',{release_id:b.release.id,name:'Price meaning',text:'Plan price is 10 USD.',target_id:b.target.id,category:'price',evidence_ids:[],subject:'price',scope:'basic',owner:'pricing',unit:'currency',currency:'USD'});
  const block=await b.create('copy_block',{release_id:b.release.id,name:'Pricing sentence',target_id:b.target.id,claim_id:claim.id,locale:'en-US',content:'Starts at $10.',owner:'human'});
  const deliverable=(await update(app,b.deliverable,{copy_block_ids:[block.id]})).entity;
  const artifact=(await execute(app,'deliverable.render',{id:deliverable.id})).entity;
  await update(app,claim,{text:'Plan price is 12 USD.'});
  const impact=app.impact(b.release.id);
  const stale=impact.items.find(i=>i.artifact_id===artifact.id);
  assert.ok(stale);
  assert.ok(stale.changed.some(c=>c.id===claim.id));
});

test('ReleaseContract exposes a real readiness denominator without treating UNKNOWN claims as verified', async t => {
  const {app}=setup(t);const b=await baseline(app);
  const claim=await b.create('claim',{release_id:b.release.id,name:'Instruction',text:'Use the export action.',target_id:b.target.id,category:'instruction',evidence_ids:[]});
  const contract=await b.create('release_contract',{release_id:b.release.id,name:'Launch minimum',required_claim_ids:[claim.id],optional_claim_ids:[],required_deliverable_ids:[b.deliverable.id]});
  let summary=app.coverage(b.release.id).contracts.find(c=>c.id===contract.id);
  assert.deepEqual({total:summary.total,ready:summary.ready,failed:summary.failed,unknown:summary.unknown},{total:2,ready:0,failed:0,unknown:2});
  await execute(app,'deliverable.render',{id:b.deliverable.id});
  summary=app.coverage(b.release.id).contracts.find(c=>c.id===contract.id);
  assert.deepEqual({total:summary.total,ready:summary.ready,unknown:summary.unknown},{total:2,ready:1,unknown:1});
});

test('anchor assessment rejects ambiguous cardinality instead of selecting an arbitrary match', async t => {
  const {app}=setup(t);const b=await baseline(app);
  const anchor=await b.create('anchor',{release_id:b.release.id,name:'Export button',source_id:b.source.id,target_id:b.target.id,strategy:'aria',value:'button:Export',expected_count:1});
  const ambiguous=await execute(app,'anchor.assess',{id:anchor.id,observed_matches:2});
  assert.equal(ambiguous.state,'FAIL');assert.equal(ambiguous.selected,false);
  const unique=await execute(app,'anchor.assess',{id:anchor.id,observed_matches:1});
  assert.equal(unique.state,'PASS');assert.equal(unique.selected,true);
});

test('impact plan is an immutable proposal and creates no jobs or execution authority', async t => {
  const {app}=setup(t);const b=await baseline(app);
  const before=app.list('work').length;
  const proposal=(await execute(app,'impact.plan',{release_id:b.release.id,cause_ids:[b.source.id],note:'Synthetic change review'})).entity;
  assert.equal(proposal.kind,'impact_proposal');
  assert.equal(proposal.data.state,'PROPOSED');
  assert.equal(proposal.data.authority,'NONE');
  assert.equal(proposal.data.jobs_created,0);
  assert.equal(app.list('work').length,before);
  await assert.rejects(update(app,proposal,{state:'EXECUTED'}),{code:'PermissionDenied'});
});

test('retiring a resource preserves identity as a redacted tombstone and invalidates pinned outputs', async t => {
  const {app}=setup(t);const b=await baseline(app);
  const claim=await b.create('claim',{release_id:b.release.id,name:'Retirable claim',text:'Sensitive claim text',target_id:b.target.id,category:'editorial',evidence_ids:[]});
  const deliverable=(await update(app,b.deliverable,{claim_ids:[claim.id]})).entity;
  const artifact=(await execute(app,'deliverable.render',{id:deliverable.id})).entity;
  const retired=(await execute(app,'entity.retire',{id:claim.id,expected:claim.version,reason:'Synthetic retention test'})).entity;
  assert.equal(retired.id,claim.id);
  assert.equal(retired.kind,'tombstone');
  assert.equal(retired.data.original_kind,'claim');
  assert.equal(retired.data.content_revoked,true);
  assert.equal('text' in retired.data,false);
  assert.equal(app.list('claim',b.release.id).length,0);
  const impact=app.impact(b.release.id);
  assert.ok(impact.items.find(i=>i.artifact_id===artifact.id)?.changed.some(c=>c.id===claim.id));
  await assert.rejects(update(app,retired,{reason:'rewrite history'}),{code:'PermissionDenied'});
});

test('parent retirement is blocked while active children still reference it', async t => {
  const {app}=setup(t);const b=await baseline(app);
  await assert.rejects(execute(app,'entity.retire',{id:b.release.id,expected:b.release.version,reason:'Should not orphan active children'}),{code:'Conflict'});
  await assert.rejects(execute(app,'entity.retire',{id:b.product.id,expected:b.product.version,reason:'Should not orphan release'}),{code:'Conflict'});
});

test('explicit relations preserve provenance and heuristic edges cannot become observed or complete by serialization', async t => {
  const {app}=setup(t);const b=await baseline(app);
  await assert.rejects(execute(app,'relation.record',{release_id:b.release.id,name:'Bad heuristic',from_id:b.source.id,to_id:b.deliverable.id,relation_kind:'source.supports',provenance:'heuristic',completeness:'complete'}),{code:'InvalidArgument'});
  await assert.rejects(execute(app,'relation.record',{release_id:b.release.id,name:'Fake observation',from_id:b.source.id,to_id:b.deliverable.id,relation_kind:'source.supports',provenance:'observed',completeness:'partial'}),{code:'PolicyDenied'});
  const relation=(await execute(app,'relation.record',{release_id:b.release.id,name:'Candidate dependency',from_id:b.source.id,to_id:b.deliverable.id,relation_kind:'source.supports',provenance:'heuristic',completeness:'partial'})).entity;
  assert.equal(relation.data.provenance,'heuristic');
  assert.equal(relation.data.completeness,'partial');
  assert.equal(relation.data.admission,'local-explicit-record');
  const impact=app.impact(b.release.id);
  assert.deepEqual(impact.relations.map(r=>({id:r.id,provenance:r.provenance,completeness:r.completeness})),[{id:relation.id,provenance:'heuristic',completeness:'partial'}]);
  await assert.rejects(update(app,relation,{provenance:'observed'}),{code:'PermissionDenied'});
});
