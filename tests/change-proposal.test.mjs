// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { execute } from '../src/application.mjs';
import { setup, baseline, update } from './helpers.mjs';

async function humanCopy(app,b){
  const claim=await b.create('claim',{release_id:b.release.id,name:'Copy meaning',text:'Synthetic owned meaning',target_id:b.target.id,category:'editorial',evidence_ids:[]});
  const block=await b.create('copy_block',{release_id:b.release.id,name:'Human headline',target_id:b.target.id,claim_id:claim.id,locale:'en-US',content:'Human original',owner:'human'});
  return{claim,block};
}
async function propose(app,entity,proposedData,origin='generator'){
  return (await execute(app,'change.propose',{
    resource_id:entity.id,base_version:entity.version,proposed_data:proposedData,
    reason:'Synthetic proposed wording change',origin
  })).entity;
}

test('proposal is immutable intent and does not edit human-owned copy',async t=>{
  const {app}=setup(t),b=await baseline(app),{block}=await humanCopy(app,b);
  const p=await propose(app,block,{...block.data,content:'Generated suggestion'});
  assert.equal(app.get(block.id).data.content,'Human original');
  assert.equal(p.kind,'change_proposal');
  assert.equal(p.data.requires_human_ack,true);
  assert.equal(p.data.automatic_apply,false);
  assert.deepEqual(p.data.changed_fields,['content']);
  const inspected=await execute(app,'change.inspect',{id:p.id});
  assert.equal(inspected.state,'READY_TO_APPLY');
  assert.equal(inspected.safe_to_apply,true);
  assert.equal(inspected.canonical_changes_authority,false);
});

test('human copy cannot be applied without explicit acknowledgement',async t=>{
  const {app}=setup(t),b=await baseline(app),{block}=await humanCopy(app,b);
  const p=await propose(app,block,{...block.data,content:'Reviewed suggestion'});
  await assert.rejects(execute(app,'change.apply',{id:p.id,proposal_sha256:p.data.proposal_sha256,acknowledge_human:false}),{code:'ConsentRequired'});
  const applied=await execute(app,'change.apply',{id:p.id,proposal_sha256:p.data.proposal_sha256,acknowledge_human:true});
  assert.equal(applied.entity.data.content,'Reviewed suggestion');
  assert.equal(applied.application.kind,'change_application');
  assert.equal(applied.application.data.explicit_human_ack,true);
  const inspected=await execute(app,'change.inspect',{id:p.id});
  assert.equal(inspected.state,'APPLIED');
  assert.equal(inspected.applications.length,1);
});

test('managed CopyBlock proposal still requires an explicit apply operation but not a human-content waiver',async t=>{
  const {app}=setup(t),b=await baseline(app);
  const claim=await b.create('claim',{release_id:b.release.id,name:'Managed meaning',text:'Synthetic meaning',target_id:b.target.id,category:'editorial',evidence_ids:[]});
  const block=await b.create('copy_block',{release_id:b.release.id,name:'Managed snippet',target_id:b.target.id,claim_id:claim.id,locale:'en-US',content:'Managed A',owner:'managed'});
  const p=await propose(app,block,{...block.data,content:'Managed B'},'managed');
  assert.equal(app.get(block.id).data.content,'Managed A');
  const applied=await execute(app,'change.apply',{id:p.id,proposal_sha256:p.data.proposal_sha256,acknowledge_human:false});
  assert.equal(applied.entity.data.content,'Managed B');
});

test('newer edits make an older proposal stale instead of being force-overwritten',async t=>{
  const {app}=setup(t),b=await baseline(app),{block}=await humanCopy(app,b);
  const p=await propose(app,block,{...block.data,content:'Old proposal'});
  await update(app,block,{content:'Newer human edit'});
  const inspected=await execute(app,'change.inspect',{id:p.id});
  assert.equal(inspected.state,'STALE_BASE');
  assert.equal(inspected.safe_to_apply,false);
  await assert.rejects(execute(app,'change.apply',{id:p.id,proposal_sha256:p.data.proposal_sha256,acknowledge_human:true}),{code:'StaleReference'});
  assert.equal(app.get(block.id).data.content,'Newer human edit');
});

test('applying a whole-document proposal requires acknowledgement and invalidates old artifact/candidate pins',async t=>{
  const {app}=setup(t),b=await baseline(app);
  const artifact=(await execute(app,'deliverable.render',{id:b.deliverable.id})).entity;
  const candidate=(await execute(app,'candidate.freeze',{
    release_id:b.release.id,name:'Before doc proposal',artifact_ids:[artifact.id],destination:'private',
    contract:{version:'v2',required_reviewers:1,require_claims_verified:false}
  })).entity;
  const p=await propose(app,b.deliverable,{...b.deliverable.data,content:'Proposed whole-document rewrite'},'generator');
  await assert.rejects(execute(app,'change.apply',{id:p.id,proposal_sha256:p.data.proposal_sha256,acknowledge_human:false}),{code:'ConsentRequired'});
  await execute(app,'change.apply',{id:p.id,proposal_sha256:p.data.proposal_sha256,acknowledge_human:true});
  const inspected=await execute(app,'candidate.inspect',{id:candidate.id});
  assert.equal(inspected.readiness.review,'BLOCKED');
  const inputGate=inspected.gates.find(gate=>gate.name==='input-versions');
  assert.equal(inputGate.state,'FAIL');
  assert.ok(inputGate.details.some(item=>item.id===b.deliverable.id));
});
