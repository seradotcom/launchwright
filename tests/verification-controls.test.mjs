// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { execute } from '../src/application.mjs';
import { setup, baseline } from './helpers.mjs';

const CASES=Object.freeze([
  {id:'wrong-screen',dimension:'semantic',kind:'wrong-screen',fixture_sha256:'1'.repeat(64),expected_outcome:'DETECTED'},
  {id:'wrong-price',dimension:'semantic',kind:'wrong-price',fixture_sha256:'2'.repeat(64),expected_outcome:'DETECTED'},
  {id:'frozen-video',dimension:'semantic',kind:'frozen-video',fixture_sha256:'3'.repeat(64),expected_outcome:'DETECTED'},
  {id:'stale-caption',dimension:'semantic',kind:'stale-caption',fixture_sha256:'4'.repeat(64),expected_outcome:'DETECTED'}
]);

async function fixture(app){
  const b=await baseline(app);
  const profile=(await execute(app,'extension.register',{
    name:'RS-E2E-20 synthetic oracle',type:'verifier_profile',package_version:'20.0.0',schema_major:1,digest:'f'.repeat(64),
    license:'AGPL-3.0-only',source:'repo:synthetic/rs-e2e-20',
    permissions:['read','review'],inputs:['candidate/2'],outputs:['verification-report/1'],
    preconditions:['candidate-frozen','exact-bytes'],evidence:['negative-control-corpus'],
    limits:{max_input_bytes:32768,max_output_bytes:32768,timeout_seconds:20},
    verifier:{dimensions:['semantic'],authority:'canonical',negative_controls:true,negative_control_cases:CASES,coverage_mode:'complete'}
  })).entity;
  const artifact=(await execute(app,'deliverable.render',{id:b.deliverable.id})).entity;
  const candidate=(await execute(app,'candidate.freeze',{
    release_id:b.release.id,name:'RS-E2E-20 candidate',artifact_ids:[artifact.id],destination:'negative-control-review',
    verifier_profile_ids:[profile.id],
    contract:{version:'rs-e2e-20',required_reviewers:1,require_claims_verified:false,required_verification_dimensions:['semantic']}
  })).entity;
  const verifier={id:profile.data.name,version:profile.data.package_version,digest:profile.data.digest,authority:'canonical'};
  const base={
    candidate_id:candidate.id,candidate_sha256:candidate.data.candidate_sha256,dimension:'semantic',state:'PASS',
    verifier,verifier_profile_id:profile.id,artifact_ids:[artifact.id],target_id:b.target.id,
    coverage:{checked:4,total:4},omissions:[],findings:[],observed_at:'2026-10-05T21:00:00.000Z'
  };
  return{b,profile,artifact,candidate,base};
}

const outcomes=(value='DETECTED')=>CASES.map(control=>({
  case_id:control.id,fixture_sha256:control.fixture_sha256,outcome:value,detail:'Synthetic corpus result'
}));

test('RS-VER-06 protected negative corpus is pinned into the candidate and missing cases cannot silently PASS',async t=>{
  const {app}=setup(t,{capabilities:{canonical_verifier_admission:true}});
  const f=await fixture(app);
  assert.deepEqual(f.candidate.data.manifest.verifier_profiles[0].negative_control_cases.map(control=>control.id),CASES.map(control=>control.id).sort());
  const verification=(await execute(app,'verification.record',{...f.base,negative_control_results:[]})).entity;
  assert.equal(verification.data.negative_control_state,'INCOMPLETE');
  assert.equal(verification.data.negative_control_results.length,4);
  assert.ok(verification.data.negative_control_results.every(result=>result.outcome==='NOT_RUN'));
  const summary=await execute(app,'verification.summary',{candidate_id:f.candidate.id});
  assert.equal(summary.state,'UNKNOWN');
  assert.equal(summary.checks[0].effective_state,'UNKNOWN');
  assert.equal(summary.checks[0].next_action,'run-missing-negative-controls');
  assert.ok(summary.checks[0].binding_reasons.includes('negative-controls-incomplete'));
});

test('RS-VER-06 a seeded benign error missed by the verifier becomes ERROR, never PASS',async t=>{
  const {app}=setup(t,{capabilities:{canonical_verifier_admission:true}});
  const f=await fixture(app);
  const results=outcomes();
  results[1]={...results[1],outcome:'MISSED',detail:'Verifier incorrectly accepted the seeded wrong price'};
  const verification=(await execute(app,'verification.record',{...f.base,negative_control_results:results})).entity;
  assert.equal(verification.data.negative_control_state,'FAILED');
  const summary=await execute(app,'verification.summary',{candidate_id:f.candidate.id});
  assert.equal(summary.state,'FAIL');
  assert.equal(summary.checks[0].reported_state,'PASS');
  assert.equal(summary.checks[0].effective_state,'ERROR');
  assert.equal(summary.checks[0].next_action,'repair-or-replace-verifier-negative-control-miss');
});

test('RS-VER-06 protected corpus rejects substituted fixture bytes and undeclared cases',async t=>{
  const {app}=setup(t,{capabilities:{canonical_verifier_admission:true}});
  const f=await fixture(app);
  const wrongDigest=outcomes();
  wrongDigest[0]={...wrongDigest[0],fixture_sha256:'a'.repeat(64)};
  await assert.rejects(execute(app,'verification.record',{...f.base,negative_control_results:wrongDigest}),{code:'Conflict'});
  await assert.rejects(execute(app,'verification.record',{...f.base,negative_control_results:[
    ...outcomes(),{case_id:'producer-added-easy-case',fixture_sha256:'b'.repeat(64),outcome:'DETECTED'}
  ]}),{code:'PermissionDenied'});
});

test('RS-VER-08 bounded repair stops after max attempts and preserves every failed attempt',async t=>{
  const {app}=setup(t,{capabilities:{canonical_verifier_admission:true}});
  const f=await fixture(app);
  const verification=(await execute(app,'verification.record',{...f.base,negative_control_results:[]})).entity;
  let repair=(await execute(app,'verification.repair_prepare',{
    verification_id:verification.id,name:'Recapture semantic proof',action:'recapture',subject_id:f.artifact.id,
    reason:'Protected negative controls were not run',
    budget:{max_attempts:2,max_runtime_seconds:30,max_cost_microunits:100,currency:'USD'}
  })).entity;
  assert.equal(repair.data.execution_authority,false);
  assert.equal(repair.data.candidate_rebuild_required,true);
  assert.equal(repair.data.next_operation,'capture.ingest');

  repair=(await execute(app,'verification.repair_record',{
    id:repair.id,expected:repair.version,outcome:'FAILED',runtime_seconds:5,cost_microunits:20,evidence_ids:[f.artifact.id],detail:'First bounded recapture did not resolve the mismatch'
  })).entity;
  assert.equal(repair.data.state,'IN_PROGRESS');assert.equal(repair.data.attempts_used,1);

  repair=(await execute(app,'verification.repair_record',{
    id:repair.id,expected:repair.version,outcome:'FAILED',runtime_seconds:5,cost_microunits:20,evidence_ids:[f.artifact.id],detail:'Second bounded recapture did not converge'
  })).entity;
  assert.equal(repair.data.state,'EXHAUSTED');assert.equal(repair.data.attempts_used,2);
  assert.equal(repair.data.attempts.length,2);
  assert.equal(repair.data.next_action,'manual-review-or-scoped-waiver');
  await assert.rejects(execute(app,'verification.repair_record',{
    id:repair.id,expected:repair.version,outcome:'FAILED',runtime_seconds:1,cost_microunits:0,evidence_ids:[f.artifact.id]
  }),{code:'Conflict'});

  const summary=await execute(app,'verification.summary',{candidate_id:f.candidate.id});
  assert.equal(summary.checks[0].repairs[0].state,'EXHAUSTED');
  assert.equal(summary.checks[0].repairs[0].attempts.length,2);
});

test('RS-VER-08 runtime or cost overrun is recorded as terminal budget breach, never hidden',async t=>{
  const {app}=setup(t,{capabilities:{canonical_verifier_admission:true}});
  const f=await fixture(app);
  const verification=(await execute(app,'verification.record',{...f.base,negative_control_results:[]})).entity;
  let repair=(await execute(app,'verification.repair_prepare',{
    verification_id:verification.id,name:'Bounded verifier rerun',action:'rerun-verifier',subject_id:verification.id,
    reason:'Retry verifier once within an explicit runtime and cost envelope',
    budget:{max_attempts:3,max_runtime_seconds:5,max_cost_microunits:10,currency:'USD'}
  })).entity;
  repair=(await execute(app,'verification.repair_record',{
    id:repair.id,expected:repair.version,outcome:'ERROR',runtime_seconds:6,cost_microunits:11,evidence_ids:[verification.id],detail:'Synthetic worker exceeded the declared envelope before erroring'
  })).entity;
  assert.equal(repair.data.state,'EXHAUSTED');
  assert.equal(repair.data.budget_breached,true);
  assert.equal(repair.data.attempts[0].budget_breached,true);
  assert.equal(repair.data.next_action,'manual-review-or-scoped-waiver');
  assert.equal(repair.data.candidate_rebuild_required,false);
});
