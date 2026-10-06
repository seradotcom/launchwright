// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { LaunchwrightApplication, execute } from '../src/application.mjs';
import { setup, baseline } from './helpers.mjs';

async function registerVerifier(app,{name='Protected semantic oracle',authority='canonical',dimensions=['semantic'],negative_controls=true,coverage_mode='complete',model,negative_control_cases}={}){
  const controls=negative_control_cases??(negative_controls?dimensions.map((dimension,index)=>({
    id:dimension+'-benign-negative-'+index,dimension,kind:['wrong-screen','wrong-price','frozen-video','stale-caption'][index%4],
    fixture_sha256:['1','2','3','4','5','6','7','8'][index%8].repeat(64),expected_outcome:'DETECTED'
  })):[]);
  return (await execute(app,'extension.register',{
    name,type:'verifier_profile',package_version:'1.4.0',schema_major:1,digest:'e'.repeat(64),
    license:'AGPL-3.0-only',source:'repo:synthetic/protected-verifier',
    permissions:['read','review'],inputs:['candidate/2'],outputs:['verification-report/1'],
    preconditions:['candidate-frozen','exact-bytes'],evidence:['negative-controls','coverage'],
    limits:{max_input_bytes:32768,max_output_bytes:32768,timeout_seconds:20},
    verifier:{dimensions,authority,negative_controls,negative_control_cases:controls,coverage_mode,...(model?{model}:{})}
  })).entity;
}
async function freezeWithVerifier(app,b,profile,{required=['semantic']}={}){
  const artifact=(await execute(app,'deliverable.render',{id:b.deliverable.id})).entity;
  const candidate=(await execute(app,'candidate.freeze',{
    release_id:b.release.id,name:'Oracle-protected candidate',artifact_ids:[artifact.id],destination:'oracle-review',
    verifier_profile_ids:profile?[profile.id]:[],
    contract:{version:'verifier-v1',required_reviewers:1,require_claims_verified:false,required_verification_dimensions:required}
  })).entity;
  return{artifact,candidate};
}
const verifierIdentity=profile=>({
  id:profile.data.name,version:profile.data.package_version,digest:profile.data.digest,
  authority:profile.data.verifier.authority,...(profile.data.verifier.model?{model:profile.data.verifier.model}:{})
});
const detectedControls=(profile,dimension='semantic')=>(profile.data.verifier.negative_control_cases??[]).filter(control=>control.dimension===dimension).map(control=>({
  case_id:control.id,fixture_sha256:control.fixture_sha256,outcome:'DETECTED',detail:'Synthetic benign negative detected'
}));
const report=(candidate,artifact,profile,overrides={})=>({
  candidate_id:candidate.id,candidate_sha256:candidate.data.candidate_sha256,dimension:'semantic',state:'PASS',
  verifier:verifierIdentity(profile),verifier_profile_id:profile.id,artifact_ids:[artifact.id],
  coverage:{checked:4,total:4},omissions:[],findings:[],negative_control_results:detectedControls(profile),
  observed_at:'2026-10-05T20:00:00.000Z',...overrides
});

test('RS-VER protected required dimensions reject unpinned, heuristic, sampled or negative-control-free oracles',async t=>{
  const {app}=setup(t);const b=await baseline(app);
  await assert.rejects(freezeWithVerifier(app,b,null),{code:'PolicyDenied'});
  const heuristic=await registerVerifier(app,{name:'Heuristic judge',authority:'heuristic',model:'synthetic-judge-v1'});
  await assert.rejects(freezeWithVerifier(app,b,heuristic),{code:'PolicyDenied'});
  const sampled=await registerVerifier(app,{name:'Sampled canonical',coverage_mode:'sampled'});
  await assert.rejects(freezeWithVerifier(app,b,sampled),{code:'PolicyDenied'});
  const noNegatives=await registerVerifier(app,{name:'Canonical without negatives',negative_controls:false});
  await assert.rejects(freezeWithVerifier(app,b,noNegatives),{code:'PolicyDenied'});
});

test('RS-VER exact protected oracle can admit PASS only for the frozen candidate bytes and context',async t=>{
  const {app}=setup(t,{capabilities:{canonical_verifier_admission:true}});const b=await baseline(app);
  const profile=await registerVerifier(app,{}),{artifact,candidate}=await freezeWithVerifier(app,b,profile);
  assert.equal(candidate.data.manifest.verifier_profiles[0].digest,profile.data.digest);
  assert.equal(candidate.data.manifest.verifier_profiles[0].negative_controls,true);
  assert.equal(candidate.data.manifest.verifier_profiles[0].coverage_mode,'complete');
  assert.equal(candidate.data.manifest.verifier_profiles[0].negative_control_cases.length,1);

  await assert.rejects(execute(app,'verification.record',report(candidate,artifact,profile,{candidate_sha256:'a'.repeat(64)})),{code:'Conflict'});
  await assert.rejects(execute(app,'verification.record',report(candidate,artifact,profile,{artifact_ids:[]})),{code:'InvalidArgument'});
  await assert.rejects(execute(app,'verification.record',report(candidate,artifact,profile,{verifier:{...verifierIdentity(profile),digest:'b'.repeat(64)}})),{code:'PolicyDenied'});
  const outside=(await execute(app,'deliverable.render',{id:b.deliverable.id})).entity;
  await assert.rejects(execute(app,'verification.record',report(candidate,outside,profile)),{code:'PermissionDenied'});

  const recorded=(await execute(app,'verification.record',report(candidate,artifact,profile,{target_id:b.target.id}))).entity;
  assert.equal(recorded.data.coverage_state,'COMPLETE');
  assert.equal(recorded.data.artifact_bindings[0].sha256,artifact.data.sha256);
  assert.equal(recorded.data.target_binding.id,b.target.id);
  assert.match(recorded.data.report_context_sha256,/^[0-9a-f]{64}$/);
  const summary=await execute(app,'verification.summary',{candidate_id:candidate.id});
  assert.equal(summary.state,'PASS');assert.equal(summary.canonical_passes,1);
  assert.equal(summary.checks[0].binding_current,true);
  assert.equal(summary.checks[0].next_action,'none');
});

test('RS-VER partial coverage never becomes PASS and verifier ERROR exposes an explicit action',async t=>{
  const {app}=setup(t,{capabilities:{canonical_verifier_admission:true}});const b=await baseline(app);
  const profile=await registerVerifier(app,{}),{artifact,candidate}=await freezeWithVerifier(app,b,profile);
  const partial=(await execute(app,'verification.record',report(candidate,artifact,profile,{
    coverage:{checked:3,total:4},omissions:['negative control: frozen-frame variant not executed']
  }))).entity;
  let summary=await execute(app,'verification.summary',{candidate_id:candidate.id});
  let check=summary.checks.find(item=>item.verification_id===partial.id);
  assert.equal(check.reported_state,'PASS');assert.equal(check.effective_state,'UNKNOWN');
  assert.equal(check.coverage_state,'PARTIAL');assert.equal(check.next_action,'complete-verification-coverage');

  const errored=(await execute(app,'verification.record',report(candidate,artifact,profile,{
    state:'ERROR',coverage:{checked:0,total:4},omissions:['verifier process timeout'],findings:[]
  }))).entity;
  summary=await execute(app,'verification.summary',{candidate_id:candidate.id});
  check=summary.checks.find(item=>item.verification_id===errored.id);
  assert.equal(check.effective_state,'ERROR');assert.equal(check.next_action,'diagnose-verifier-before-rerun');
  assert.equal(summary.state,'FAIL');
});

test('RS-VER retiring a protected oracle invalidates prior PASS without deleting evidence',async t=>{
  const {app}=setup(t,{capabilities:{canonical_verifier_admission:true}});const b=await baseline(app);
  const profile=await registerVerifier(app,{}),{artifact,candidate}=await freezeWithVerifier(app,b,profile);
  const verification=(await execute(app,'verification.record',report(candidate,artifact,profile))).entity;
  assert.equal((await execute(app,'verification.summary',{candidate_id:candidate.id})).state,'PASS');
  await execute(app,'extension.retire',{id:profile.id,expected:profile.version,reason:'Synthetic oracle rotation'});
  const summary=await execute(app,'verification.summary',{candidate_id:candidate.id});
  const check=summary.checks.find(item=>item.verification_id===verification.id);
  assert.equal(check.effective_state,'UNKNOWN');assert.equal(check.binding_current,false);
  assert.ok(check.binding_reasons.includes('verifier-profile-stale'));
  assert.equal((await execute(app,'candidate.inspect',{id:candidate.id})).fresh,false);
});

test('RS-VER verifier descriptors are admin-protected and cannot be replaced by a producer session',async t=>{
  const {app,root}=setup(t);await baseline(app);
  const producer=new LaunchwrightApplication(root,{principal:'producer',scopes:['read','edit','review']});
  t.after(()=>{try{producer.close();}catch{}});
  await assert.rejects(registerVerifier(producer,{name:'Producer-controlled oracle'}),{code:'PermissionDenied'});
  const profile=await registerVerifier(app,{name:'Owner-approved oracle'});
  assert.equal(profile.data.remote_code_executable,false);
  assert.equal(profile.data.verifier.authority,'canonical');
});
