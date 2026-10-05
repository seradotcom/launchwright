// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { execute } from '../src/application.mjs';
import { buildPrivateChannelBundle, deterministicZip } from '../src/channel-bundle.mjs';
import { setup, baseline } from './helpers.mjs';

async function packaged(app,b){
  const artifact=(await execute(app,'deliverable.render',{id:b.deliverable.id})).entity;
  const profile=await b.create('channel_profile',{
    product_id:b.product.id,name:'Private bundle',channel:'private-bundle',profile_version:'2026-10-05',
    destination_class:'private',requirements:{format:'zip'},source:'launchwright-private-bundle/1',
    effective_at:'2026-10-05T00:00:00.000Z',idempotency:'safe'
  });
  const candidate=(await execute(app,'candidate.freeze',{
    release_id:b.release.id,name:'Bundle candidate',artifact_ids:[artifact.id],destination:'private-bundle',
    channel_profile_ids:[profile.id],contract:{version:'v2',required_reviewers:1,require_claims_verified:false}
  })).entity;
  const delivery=(await execute(app,'channel.package',{
    candidate_id:candidate.id,profile_id:profile.id,participant:'reviewer-a',locale:'en-US',allow_partial:false,omissions:[]
  })).entity;
  return{artifact,profile,candidate,delivery};
}

test('private channel bundle is deterministic and includes exact manifests plus artifact bytes',async t=>{
  const {app}=setup(t),b=await baseline(app),x=await packaged(app,b);
  const manifest=JSON.parse(app.store.readBlob(x.delivery.data.package_sha256).bytes.toString());
  assert.equal(manifest.schema_version,'launchwright-channel-package/2');
  assert.equal(manifest.bundle_recipe,'private-zip-v1');
  assert.equal(manifest.candidate_manifest_sha256,x.delivery.data.candidate_manifest_sha256);
  assert.equal(manifest.artifacts[0].sha256,x.artifact.data.sha256);
  assert.equal(manifest.artifacts[0].extension,'md');
  assert.equal(manifest.artifacts[0].mime,'text/markdown; charset=utf-8');

  const first=buildPrivateChannelBundle(app,x.delivery.id),second=buildPrivateChannelBundle(app,x.delivery.id);
  assert.equal(first.sha256,second.sha256);
  assert.deepEqual(first.bytes,second.bytes);
  assert.equal(first.bytes.subarray(0,4).toString('hex'),'504b0304');
  assert.deepEqual(first.entries.map(e=>e.name),[
    'manifest/channel-package.json',
    'manifest/release-candidate.json',
    `artifacts/01-${x.artifact.id}.md`,
    'README.txt'
  ]);
  assert.ok(first.bytes.includes(app.store.readBlob(x.artifact.data.sha256).bytes));
});

test('delivery outcome keeps the same reconstructable private bundle without implying publication',async t=>{
  const {app}=setup(t),b=await baseline(app),x=await packaged(app,b);
  const before=buildPrivateChannelBundle(app,x.delivery.id);
  const observed=(await execute(app,'channel.record_outcome',{
    delivery_id:x.delivery.id,state:'UNKNOWN',observed_at:'2026-10-05T04:00:00.000Z',message:'Synthetic lost response'
  })).entity;
  assert.equal(observed.data.candidate_manifest_sha256,x.delivery.data.candidate_manifest_sha256);
  assert.equal(observed.data.bundle_recipe,'private-zip-v1');
  const after=buildPrivateChannelBundle(app,observed.id);
  assert.equal(after.sha256,before.sha256);
  assert.deepEqual(after.bytes,before.bytes);
  assert.equal(observed.data.external_state,'UNKNOWN');
});

test('zip builder rejects unsafe names and duplicate entries',()=>{
  assert.throws(()=>deterministicZip([{name:'../secret',bytes:Buffer.from('x')}]),{code:'InvalidArgument'});
  assert.throws(()=>deterministicZip([{name:'a.txt',bytes:Buffer.from('x')},{name:'a.txt',bytes:Buffer.from('y')}]),{code:'InvalidArgument'});
});
