// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { LaunchwrightApplication, execute } from '../src/application.mjs';
import { setup, baseline, update } from './helpers.mjs';

const profileData=(productId,overrides={})=>({
  product_id:productId,
  name:'Owned static destination',
  profile_version:'2026-10-05',
  channel:'static-site',
  delivery_mode:'publish',
  formats:['markdown'],
  locales:['en-US'],
  max_artifact_bytes:1024*1024,
  idempotency:'reconcile',
  withdrawal:'supported',
  provenance:'Owned synthetic destination profile used only for lifecycle tests.',
  reviewed_at:'2026-10-05T00:00:00.000Z',
  ...overrides,
});

async function readyCandidate(app,b,profiles){
  const artifact=(await execute(app,'deliverable.render',{id:b.deliverable.id})).entity;
  const candidate=(await execute(app,'candidate.freeze',{
    release_id:b.release.id,
    name:'Channel-ready candidate',
    artifact_ids:[artifact.id],
    channel_profile_ids:profiles.map(p=>p.id),
    destination:'release-draft',
    contract:{version:'channel-review-v1',required_reviewers:1,require_claims_verified:false,required_dimensions:['editorial']},
  })).entity;
  await execute(app,'candidate.review',{id:candidate.id,candidate_sha256:candidate.data.candidate_sha256,dimension:'editorial',decision:'approve',comment:'Owned synthetic channel review.'});
  return{artifact,candidate};
}
async function prepare(app,candidate,profile,logicalKey='launch:en-us',extra={}){
  return (await execute(app,'channel.prepare',{
    candidate_id:candidate.id,
    candidate_sha256:candidate.data.candidate_sha256,
    channel_profile_id:profile.id,
    logical_key:logicalKey,
    authorization:'explicit-channel-delivery',
    ...extra,
  })).entity;
}
async function claim(app,attempt){
  return execute(app,'channel.claim',{
    id:attempt.id,
    prepared_record:{schema_version:'synthetic-channel-request/1',logical_key:attempt.data.logical_key,candidate_sha256:attempt.data.candidate_sha256,channel:attempt.data.channel_policy.channel},
    acknowledge_external_effect:true,
  });
}

test('channel preparation pins exact candidate/profile and blocks accidental duplicate logical sends',async t=>{
  const {app}=setup(t),b=await baseline(app),profile=await b.create('channel_profile',profileData(b.product.id));
  const {candidate}=await readyCandidate(app,b,[profile]);
  const attempt=await prepare(app,candidate,profile);
  assert.equal(attempt.data.state,'PREPARED');
  assert.equal(attempt.data.external_state,'NOT_SENT');
  assert.equal(attempt.data.resent,false);
  const inspected=await execute(app,'channel.inspect',{id:attempt.id});
  assert.equal(inspected.compatibility.ready,true);
  assert.equal(inspected.channel_profile_version_current,true);
  assert.equal(inspected.automatic_resend_allowed,false);
  await assert.rejects(prepare(app,candidate,profile),err=>err?.code==='Conflict');

  const unpinned=await b.create('channel_profile',profileData(b.product.id,{name:'Unpinned docs',channel:'docs-repo'}));
  await assert.rejects(prepare(app,candidate,unpinned,'docs:en-us'),err=>err?.code==='PolicyDenied');
});

test('ChannelProfile format and byte limits are enforced before an external attempt exists',async t=>{
  const {app}=setup(t),b=await baseline(app),profile=await b.create('channel_profile',profileData(b.product.id,{formats:['html'],max_artifact_bytes:1}));
  const {candidate}=await readyCandidate(app,b,[profile]);
  const compatibility=app.channelCompatibility(candidate,profile);
  assert.equal(compatibility.ready,false);
  assert.ok(compatibility.issues.some(i=>i.reason==='artifact-format-not-allowed'));
  assert.ok(compatibility.issues.some(i=>i.reason==='artifact-exceeds-channel-limit'));
  await assert.rejects(prepare(app,candidate,profile),err=>err?.code==='PolicyDenied');
  assert.equal(app.list('channel_attempt',b.release.id).length,0);
});

test('a ChannelProfile revision after freeze prevents dispatch of the already prepared attempt',async t=>{
  const {app}=setup(t),b=await baseline(app),profile=await b.create('channel_profile',profileData(b.product.id));
  const {candidate}=await readyCandidate(app,b,[profile]),attempt=await prepare(app,candidate,profile);
  await update(app,profile,{profile_version:'2026-10-06'});
  const inspected=await execute(app,'channel.inspect',{id:attempt.id});
  assert.equal(inspected.channel_profile_version_current,false);
  assert.equal(inspected.compatibility.ready,false);
  await assert.rejects(claim(app,attempt),err=>err?.code==='StaleReference');
});

test('transport acceptance is SENT, never published, until destination observation proves publication',async t=>{
  const {app}=setup(t),b=await baseline(app),profile=await b.create('channel_profile',profileData(b.product.id));
  const {candidate}=await readyCandidate(app,b,[profile]),attempt=await prepare(app,candidate,profile);
  const claimed=await claim(app,attempt);
  const sent=(await execute(app,'channel.complete',{
    id:attempt.id,pending_digest:claimed.pending_digest,
    outcome:{transport:'accepted',provider_state:'sent',external_id:'owned-release-17'},
  })).entity;
  assert.equal(sent.data.state,'SENT');
  assert.equal(sent.data.observation,null);

  await assert.rejects(execute(app,'channel.reconcile',{
    id:attempt.id,pending_digest:claimed.pending_digest,
    observation:{state:'published',source:'owned-static-api',checked_at:'2026-10-05T01:00:00.000Z'},
  }),err=>err?.code==='PolicyDenied');

  const published=(await execute(app,'channel.reconcile',{
    id:attempt.id,pending_digest:claimed.pending_digest,
    observation:{state:'published',source:'owned-static-api',checked_at:'2026-10-05T01:01:00.000Z',fingerprint:'sha256:owned-observed-version',external_id:'owned-release-17'},
  })).entity;
  assert.equal(published.data.state,'OBSERVED_PUBLISHED');
  assert.equal(published.data.resent,false);
  const board=await execute(app,'release.channels',{release_id:b.release.id});
  assert.equal(board.atomic_across_channels,false);
  assert.equal(board.state_counts.OBSERVED_PUBLISHED,1);
});

test('lost acknowledgement becomes UNKNOWN and requires reconcile before an explicit retry',async t=>{
  const {app}=setup(t),b=await baseline(app),profile=await b.create('channel_profile',profileData(b.product.id));
  const {candidate}=await readyCandidate(app,b,[profile]),attempt=await prepare(app,candidate,profile),claimed=await claim(app,attempt);
  const unknown=(await execute(app,'channel.mark_unknown',{id:attempt.id,pending_digest:claimed.pending_digest})).entity;
  assert.equal(unknown.data.state,'UNKNOWN');
  assert.equal(unknown.data.resent,false);
  await assert.rejects(claim(app,unknown),err=>err?.code==='Conflict');

  const reconciled=await execute(app,'channel.reconcile',{
    id:attempt.id,pending_digest:claimed.pending_digest,
    observation:{state:'not_found',source:'owned-static-api',checked_at:'2026-10-05T01:10:00.000Z'},
  });
  assert.equal(reconciled.entity.data.state,'FAILED');
  assert.equal(reconciled.entity.data.reconciliation_outcome,'NOT_FOUND');
  assert.equal(reconciled.retry_allowed,true);
  assert.equal(reconciled.resent,false);

  const retry=await prepare(app,candidate,profile,'launch:en-us',{retry_of:attempt.id});
  assert.equal(retry.data.attempt_no,2);
  assert.equal(retry.data.retry_of,attempt.id);
  assert.equal(retry.data.state,'PREPARED');
  await assert.rejects(prepare(app,candidate,profile),err=>err?.code==='Conflict');
});

test('participants keep independent channel state; one UNKNOWN does not roll back another SENT participant',async t=>{
  const {app}=setup(t),b=await baseline(app);
  const staticProfile=await b.create('channel_profile',profileData(b.product.id));
  const docsProfile=await b.create('channel_profile',profileData(b.product.id,{name:'Owned docs repo',channel:'docs-repo',delivery_mode:'upload'}));
  const {candidate}=await readyCandidate(app,b,[staticProfile,docsProfile]);
  const first=await prepare(app,candidate,staticProfile,'static:en-us'),second=await prepare(app,candidate,docsProfile,'docs:en-us');
  const c1=await claim(app,first),c2=await claim(app,second);
  await execute(app,'channel.complete',{id:first.id,pending_digest:c1.pending_digest,outcome:{transport:'accepted',provider_state:'sent'}});
  await execute(app,'channel.mark_unknown',{id:second.id,pending_digest:c2.pending_digest});
  const board=await execute(app,'release.channels',{release_id:b.release.id});
  assert.equal(board.participant_states_independent,true);
  assert.equal(board.state_counts.SENT,1);
  assert.equal(board.state_counts.UNKNOWN,1);
  assert.equal(board.attempts.length,2);
});

test('withdrawal is a bounded plan and never claims downstream copies were deleted',async t=>{
  const {app}=setup(t),b=await baseline(app),profile=await b.create('channel_profile',profileData(b.product.id));
  const {candidate}=await readyCandidate(app,b,[profile]),attempt=await prepare(app,candidate,profile),claimed=await claim(app,attempt);
  await assert.rejects(execute(app,'channel.complete',{id:attempt.id,pending_digest:claimed.pending_digest,outcome:{transport:'accepted',provider_state:'published',external_id:'owned-release-18'}}),err=>err?.code==='PolicyDenied');
  const published=(await execute(app,'channel.complete',{
    id:attempt.id,pending_digest:claimed.pending_digest,
    outcome:{transport:'accepted',provider_state:'published',external_id:'owned-release-18',observation:{source:'owned-static-api',fingerprint:'sha256:published-owned-version',inspected_at:'2026-10-05T01:20:00.000Z'}},
  })).entity;
  assert.equal(published.data.state,'OBSERVED_PUBLISHED');
  const withdrawal=(await execute(app,'channel.withdraw_plan',{id:attempt.id,reason:'Superseded synthetic release.',scope:'published-version'})).entity;
  assert.equal(withdrawal.data.state,'PLAN_ONLY');
  assert.equal(withdrawal.data.external_action_performed,false);
  assert.equal(withdrawal.data.all_copies_removed,false);
  assert.equal(withdrawal.data.universe_complete,false);
  assert.equal(withdrawal.data.channel_capability,'supported');
});
