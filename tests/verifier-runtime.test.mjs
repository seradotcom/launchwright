// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execute } from '../src/application.mjs';
import { candidateManifestDigest, PINNED_SEMWRIGHT_SHA } from '../src/verification-runtime.mjs';
import { setup, baseline, candidate } from './helpers.mjs';

const observedAt='2026-10-07T08:00:00.000Z';
const executableSha='d'.repeat(64);

function exactReceipt(c,artifact,overrides={}){
  const frozen=c.data.manifest.artifacts.find(item=>item.id===artifact.id);
  const report={
    schema_version:'launchwright-verifier-result/1',
    state:'PASS',
    candidate_id:c.id,
    candidate_sha256:c.data.candidate_sha256,
    candidate_manifest_sha256:candidateManifestDigest(c),
    dimension:'format',
    coverage:{checked:1,total:1},
    artifact_bindings:[{id:frozen.id,sha256:frozen.sha256,bytes:frozen.bytes,mime:frozen.mime,result:'PASS'}],
    findings:[]
  };
  return{
    schema_version:'launchwright-canonical-verifier-runtime/1',
    observed_at:observedAt,
    semwright_sha:PINNED_SEMWRIGHT_SHA,
    provider:'driver:launchwright-verifier',
    provider_version:'0.2.0-dev.2',
    provider_generation:7,
    descriptor_sha256:'c'.repeat(64),
    executable_sha256:executableSha,
    broker_policy_path_observed:true,
    driver_host_isolation_accepted:true,
    platform_execution_authority:false,
    external_customer_acceptance:false,
    report,
    ...overrides,
    report:{...report,...(overrides.report??{})}
  };
}

function pinReceipt(root,name,receipt){
  const bytes=Buffer.from(JSON.stringify(receipt,null,2)+'\n');
  writeFileSync(join(root,name),bytes,{mode:0o600});
  return{file:name,sha256:createHash('sha256').update(bytes).digest('hex')};
}

function recordInput(c,artifact,receiptRef,receipt){
  return{
    candidate_id:c.id,
    dimension:'format',
    state:receipt.report.state,
    verifier:{id:'launchwright-verifier',version:receipt.provider_version,digest:receipt.executable_sha256,authority:'canonical'},
    artifact_ids:[artifact.id],
    coverage:structuredClone(receipt.report.coverage),
    omissions:[],
    findings:structuredClone(receipt.report.findings),
    observed_at:receipt.observed_at,
    runtime_receipt:receiptRef
  };
}

test('exact Driver Host receipt admits one candidate-wide canonical format PASS',async t=>{
  const {app,verificationReceiptRoot}=setup(t),b=await baseline(app),{artifact,candidate:c}=await candidate(app,b);
  const receipt=exactReceipt(c,artifact),ref=pinReceipt(verificationReceiptRoot,'r26-pass.json',receipt);
  const stored=(await execute(app,'verification.record',recordInput(c,artifact,ref,receipt))).entity;
  assert.equal(stored.data.admission,'canonical-owner-admitted');
  assert.equal(stored.data.runtime_admission.provider,'driver:launchwright-verifier');
  assert.equal(stored.data.runtime_admission.driver_host_isolation_accepted,true);
  assert.equal(stored.data.runtime_admission.receipt_sha256,ref.sha256);
  assert.equal(stored.data.runtime_admission.scope,'owner-granted-driver-host-format-only');
  const summary=await execute(app,'verification.summary',{candidate_id:c.id});
  assert.equal(summary.state,'PASS');
  assert.equal(summary.canonical_passes,1);
});

test('canonical verifier rejects stale candidate identity even when receipt bytes are correctly pinned',async t=>{
  const {app,verificationReceiptRoot}=setup(t),b=await baseline(app),{artifact,candidate:c}=await candidate(app,b);
  const receipt=exactReceipt(c,artifact,{report:{candidate_sha256:'e'.repeat(64)}}),ref=pinReceipt(verificationReceiptRoot,'r26-stale.json',receipt);
  await assert.rejects(execute(app,'verification.record',recordInput(c,artifact,ref,receipt)),{code:'StaleReference'});
});

test('canonical verifier rejects artifact substitution and external-authority escalation',async t=>{
  const {app,verificationReceiptRoot}=setup(t),b=await baseline(app),{artifact,candidate:c}=await candidate(app,b);
  const substituted=exactReceipt(c,artifact,{report:{artifact_bindings:[{id:artifact.id,sha256:'f'.repeat(64),bytes:artifact.data.size_bytes,mime:artifact.data.mime,result:'PASS'}]}}),subRef=pinReceipt(verificationReceiptRoot,'r26-substitution.json',substituted);
  await assert.rejects(execute(app,'verification.record',recordInput(c,artifact,subRef,substituted)),{code:'Conflict'});
  const escalated=exactReceipt(c,artifact,{platform_execution_authority:true}),escRef=pinReceipt(verificationReceiptRoot,'r26-escalation.json',escalated);
  await assert.rejects(execute(app,'verification.record',recordInput(c,artifact,escRef,escalated)),{code:'Conflict'});
});

test('receipt digest is checked before semantic admission and cannot be attached to noncanonical reports',async t=>{
  const {app,verificationReceiptRoot}=setup(t),b=await baseline(app),{artifact,candidate:c}=await candidate(app,b);
  const receipt=exactReceipt(c,artifact),ref=pinReceipt(verificationReceiptRoot,'r26-digest.json',receipt);
  await assert.rejects(execute(app,'verification.record',recordInput(c,artifact,{...ref,sha256:'0'.repeat(64)},receipt)),{code:'Conflict'});
  await assert.rejects(execute(app,'verification.record',{...recordInput(c,artifact,ref,receipt),verifier:{id:'independent',version:'1',digest:'1'.repeat(64),authority:'independent'}}),{code:'InvalidArgument'});
});


test('credential-exposure canonical receipt remains a separate narrow admission',async t=>{
  const{app,verificationReceiptRoot}=setup(t),b=await baseline(app),{artifact,candidate:c}=await candidate(app,b);
  const receipt=exactReceipt(c,artifact,{report:{dimension:'credential-exposure'}}),ref=pinReceipt(verificationReceiptRoot,'r30-credential.json',receipt);
  const input={...recordInput(c,artifact,ref,receipt),dimension:'credential-exposure'};
  const stored=(await execute(app,'verification.record',input)).entity;
  assert.equal(stored.data.admission,'canonical-owner-admitted');
  assert.equal(stored.data.runtime_admission.scope,'owner-granted-driver-host-text-credential-patterns-only');
  assert.equal(stored.data.dimension,'credential-exposure');
  const summary=await execute(app,'verification.summary',{candidate_id:c.id});
  assert.equal(summary.canonical_passes,1);
  assert.equal(summary.checks[0].dimension,'credential-exposure');
  assert.equal(summary.checks[0].effective_state,'PASS');
  assert.equal(summary.checks.some(check=>check.dimension==='privacy'),false);
});

test('credential receipt cannot be relabeled format, privacy or another candidate',async t=>{
  const{app,verificationReceiptRoot}=setup(t),b=await baseline(app),{artifact,candidate:c}=await candidate(app,b);
  const receipt=exactReceipt(c,artifact,{report:{dimension:'credential-exposure'}}),ref=pinReceipt(verificationReceiptRoot,'r30-mismatch.json',receipt);
  const input={...recordInput(c,artifact,ref,receipt),dimension:'credential-exposure'};
  await assert.rejects(execute(app,'verification.record',{...input,dimension:'format'}),{code:'Conflict'});
  await assert.rejects(execute(app,'verification.record',{...input,dimension:'privacy'}),{code:'Conflict'});
  const forged=exactReceipt(c,artifact,{report:{dimension:'credential-exposure',candidate_sha256:'0'.repeat(64)}}),bad=pinReceipt(verificationReceiptRoot,'r30-candidate.json',forged);
  await assert.rejects(execute(app,'verification.record',{...input,observed_at:forged.observed_at,runtime_receipt:bad}),{code:'StaleReference'});
});

test('credential-exposure can be a required gate without satisfying general privacy',async t=>{
  const{app,verificationReceiptRoot}=setup(t),b=await baseline(app);
  const artifact=(await execute(app,'deliverable.render',{id:b.deliverable.id})).entity;
  const c=(await execute(app,'candidate.freeze',{
    release_id:b.release.id,name:'Credential gate candidate',artifact_ids:[artifact.id],
    destination:'private-review',
    contract:{version:'r30',required_reviewers:1,require_claims_verified:false,required_verification_dimensions:['credential-exposure','privacy']}
  })).entity;
  let inspected=await execute(app,'candidate.inspect',{id:c.id});
  assert.equal(inspected.gates.find(g=>g.name==='verification-records').state,'UNKNOWN');
  const receipt=exactReceipt(c,artifact,{report:{dimension:'credential-exposure'}}),ref=pinReceipt(verificationReceiptRoot,'r30-gate.json',receipt);
  await execute(app,'verification.record',{...recordInput(c,artifact,ref,receipt),dimension:'credential-exposure'});
  inspected=await execute(app,'candidate.inspect',{id:c.id});
  const gate=inspected.gates.find(g=>g.name==='verification-records');
  assert.equal(gate.state,'UNKNOWN');
  assert.equal(gate.details.required.find(x=>x.dimension==='credential-exposure').state,'PASS');
  assert.equal(gate.details.required.find(x=>x.dimension==='privacy').state,'UNKNOWN');
});
