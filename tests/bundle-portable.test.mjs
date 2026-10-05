// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { rmSync } from 'node:fs';
import { LaunchwrightApplication, execute } from '../src/application.mjs';
import { exportWorkspace, inspectWorkspaceExport, restoreWorkspace } from '../src/portable.mjs';
import { readStoredZip } from '../src/zip.mjs';
import { setup, baseline, candidate, review, update } from './helpers.mjs';

const profileData=productId=>({
  product_id:productId,
  name:'Owned static profile',
  profile_version:'2026-10-04',
  channel:'static-site',
  delivery_mode:'publish',
  formats:['html','markdown'],
  locales:['en-US','es-MX'],
  max_artifact_bytes:8*1024*1024,
  idempotency:'reconcile',
  withdrawal:'supported',
  provenance:'Owned laboratory destination profile; no third-party acceptance is inferred.',
  reviewed_at:'2026-10-04T00:00:00.000Z',
});

test('channel profile version is frozen into the candidate and review dimensions remain separate', async t=>{
  const {app,root}=setup(t),b=await baseline(app);
  const profile=await b.create('channel_profile',profileData(b.product.id));
  const artifact=(await execute(app,'deliverable.render',{id:b.deliverable.id})).entity;
  const c=(await execute(app,'candidate.freeze',{
    release_id:b.release.id,name:'Multi-review candidate',artifact_ids:[artifact.id],destination:'owned-static',
    channel_profile_ids:[profile.id],
    contract:{version:'review-v2',required_reviewers:1,require_claims_verified:false,required_dimensions:['editorial','permissions']},
  })).entity;
  assert.deepEqual(c.data.manifest.channel_profile_ids,[profile.id]);
  assert.ok(c.data.manifest.inputs.some(pin=>pin.id===profile.id));
  let inspected=app.inspectCandidate(c);
  assert.equal(inspected.review_dimensions.editorial.state,'PENDING');
  assert.equal(inspected.review_dimensions.permissions.state,'PENDING');
  assert.equal(inspected.review_ready,false);

  await execute(app,'candidate.review',{id:c.id,candidate_sha256:c.data.candidate_sha256,dimension:'editorial',decision:'approve',comment:'Editorial copy approved.'});
  const reviewer=new LaunchwrightApplication(root,{principal:'publisher-reviewer',scopes:['read','review']});
  t.after(()=>reviewer.close());
  await execute(reviewer,'candidate.review',{id:c.id,candidate_sha256:c.data.candidate_sha256,dimension:'permissions',decision:'approve',comment:'Owned destination and rights approved.'});
  inspected=app.inspectCandidate(c);
  assert.equal(inspected.review_dimensions.editorial.state,'APPROVED');
  assert.equal(inspected.review_dimensions.permissions.state,'APPROVED');
  assert.equal(inspected.review_ready,true);
  assert.equal(inspected.technical_state,'UNKNOWN');

  await update(app,profile,{profile_version:'2026-10-05'});
  inspected=app.inspectCandidate(c);
  assert.equal(inspected.fresh,false);
  assert.ok(inspected.gates.find(g=>g.name==='input-versions').details.some(d=>d.id===profile.id));
});

test('waiver is durable review evidence but never changes a failed review into approval', async t=>{
  const {app}=setup(t),b=await baseline(app);
  const artifact=(await execute(app,'deliverable.render',{id:b.deliverable.id})).entity;
  const c=(await execute(app,'candidate.freeze',{
    release_id:b.release.id,name:'Waiver candidate',artifact_ids:[artifact.id],destination:'private-review',
    contract:{version:'review-v2',required_reviewers:1,require_claims_verified:false,required_dimensions:['technical']},
  })).entity;
  const r=(await execute(app,'candidate.review',{
    id:c.id,candidate_sha256:c.data.candidate_sha256,dimension:'technical',decision:'request-changes',
    comment:'Native execution evidence is still missing.',
    waiver:{reason:'Allow discussion of the draft only; do not publish.',valid_until:'2026-10-10T00:00:00.000Z'},
  })).entity;
  assert.equal(r.data.waiver.reason.startsWith('Allow discussion'),true);
  const inspected=app.inspectCandidate(c);
  assert.equal(inspected.review_dimensions.technical.state,'CHANGES_REQUESTED');
  assert.equal(inspected.review_ready,false);
  assert.equal(inspected.technical_state,'UNKNOWN');
});

test('candidate export produces deterministic real ZIP bytes without recording a delivery', async t=>{
  const {app}=setup(t),b=await baseline(app),made=await candidate(app,b);
  const before=app.list('delivery').length;
  const first=(await execute(app,'candidate.export_bundle',{id:made.candidate.id,candidate_sha256:made.candidate.data.candidate_sha256})).entity;
  const second=(await execute(app,'candidate.export_bundle',{id:made.candidate.id,candidate_sha256:made.candidate.data.candidate_sha256})).entity;
  assert.equal(first.kind,'bundle');
  assert.equal(first.data.state,'EXPORTED_NOT_DELIVERED');
  assert.equal(first.data.sha256,second.data.sha256);
  assert.equal(app.list('delivery').length,before);
  const zip=app.store.readBlob(first.data.sha256).bytes;
  assert.equal(zip.subarray(0,2).toString(),'PK');
  const entries=readStoredZip(zip);
  const manifest=JSON.parse(entries.get('manifest.json').toString('utf8'));
  assert.equal(manifest.candidate_sha256,made.candidate.data.candidate_sha256);
  const artifactBytes=app.store.readBlob(made.artifact.data.sha256).bytes;
  assert.deepEqual(entries.get(`artifacts/${made.artifact.id}.${made.artifact.data.extension}`),artifactBytes);
});

test('portable export and restore preserve domain identity but rotate workspace generation and omit replay state', async t=>{
  const {app,root}=setup(t),b=await baseline(app),made=await candidate(app,b);
  await review(app,made.candidate);
  await execute(app,'candidate.deliver_private',{id:made.candidate.id,candidate_sha256:made.candidate.data.candidate_sha256,alias_expected:null,acknowledge_draft:true});
  await execute(app,'work.prepare',{release_id:b.release.id,name:'Pending owned observation',action:'graph.observe',arguments:{},budget:{max_cost_microunits:0,currency:'USD',max_runtime_seconds:10}});
  const sourceVersion=app.store.version(),sourceEvents=app.store.db.prepare('SELECT count(*) AS n FROM events').get().n;
  const exported=exportWorkspace(app);
  const inspected=inspectWorkspaceExport(exported.bytes);
  assert.equal(inspected.sha256,exported.sha256);
  assert.equal(inspected.manifest.omissions.receipts,'excluded-to-prevent-replay');
  assert.equal(inspected.manifest.omissions.pending_dispatch,'excluded-to-prevent-resend');

  const restored=join(dirname(root),'launchwright-restored-'+randomUUID());
  t.after(()=>rmSync(restored,{recursive:true,force:true}));
  const preview=restoreWorkspace(exported.bytes,restored);
  assert.equal(preview.commit,false);
  assert.equal(preview.receipts_restored,0);
  const committed=restoreWorkspace(exported.bytes,restored,{commit:true});
  assert.equal(committed.commit,true);
  const reopened=new LaunchwrightApplication(restored,{readOnly:true});
  t.after(()=>reopened.close());
  assert.equal(reopened.get(b.product.id).data.name,b.product.data.name);
  assert.notEqual(reopened.store.version().generation,sourceVersion.generation);
  assert.equal(reopened.store.version().revision,(BigInt(sourceVersion.revision)+1n).toString());
  assert.equal(reopened.store.db.prepare('SELECT count(*) AS n FROM receipts').get().n,0);
  assert.equal(reopened.store.db.prepare('SELECT count(*) AS n FROM pending').get().n,0);
  assert.equal(reopened.store.db.prepare('SELECT count(*) AS n FROM events').get().n,sourceEvents+1);
  assert.equal(reopened.store.db.prepare('SELECT candidate_id FROM aliases WHERE name=?').get('release-draft').candidate_id,made.candidate.id);
});

test('artifact integrity failure blocks private export instead of being treated as draft-safe', async t=>{
  const {app}=setup(t),b=await baseline(app),made=await candidate(app,b);
  app.store.db.prepare('UPDATE blobs SET content=? WHERE sha256=?').run(Buffer.from('corrupt synthetic bytes'),made.artifact.data.sha256);
  const inspected=app.inspectCandidate(made.candidate);
  assert.equal(inspected.gates.find(g=>g.name==='artifact-bytes').state,'FAIL');
  assert.equal(inspected.private_draft_allowed,false);
  await assert.rejects(execute(app,'candidate.export_bundle',{id:made.candidate.id,candidate_sha256:made.candidate.data.candidate_sha256}),err=>err?.code==='StaleReference');
});

test('portable reader rejects corrupted blob bytes instead of restoring them', async t=>{
  const {app}=setup(t),b=await baseline(app);
  const artifact=(await execute(app,'deliverable.render',{id:b.deliverable.id})).entity;
  const exported=exportWorkspace(app),bad=Buffer.from(exported.bytes),needle=app.store.readBlob(artifact.data.sha256).bytes;
  const at=bad.indexOf(needle);assert.ok(at>=0);
  bad[at]^=0x01;
  assert.throws(()=>inspectWorkspaceExport(bad),err=>err?.code==='Conflict');
});
