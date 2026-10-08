// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execute } from '../src/application.mjs';
import { ExtensionRuntimeNativeApplication } from '../src/native-extension-runtime-app.mjs';
import { EXTENSION_RUNTIME_SEMWRIGHT_SHA } from '../src/extension-runtime.mjs';
import { setup, baseline } from './helpers.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const executableSha='e'.repeat(64);

function extensionManifest(type,name,input,output,digest){
  return{name,type,package_version:'1.0.0',schema_major:1,digest,license:'AGPL-3.0-only',rights:'owned',
    source:'repo:fixtures/'+name.toLowerCase(),permissions:['read','capture'],inputs:[input],outputs:[output],
    preconditions:['approved-fixture'],evidence:['driver-host-receipt'],
    limits:{max_input_bytes:65536,max_output_bytes:65536,timeout_seconds:10}};
}
function envelope(report,overrides={}){
  const command=report.kind==='renderer'?'driver.launchwright-extension.render':'driver.launchwright-extension.cli-status';
  return{
    schema_version:'launchwright-extension-runtime/1',
    observed_at:'2026-10-08T00:00:00.100Z',
    semwright_sha:EXTENSION_RUNTIME_SEMWRIGHT_SHA,
    provider:'driver:launchwright-extension',
    provider_version:'0.2.0-dev.1',
    provider_generation:9,
    descriptor_sha256:'d'.repeat(64),
    executable_sha256:executableSha,
    command,
    broker_policy_path_observed:true,
    driver_host_isolation_accepted:true,
    platform_execution_authority:false,
    external_customer_acceptance:false,
    report,
    ...overrides,
    report:{...report,...(overrides.report??{})}
  };
}
function pin(root,name,value){
  const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');
  writeFileSync(join(root,name),bytes,{mode:0o600});
  return{file:name,sha256:sha(bytes)};
}
function common(kind,fixtureSha,stdout,stderr=''){
  return{
    schema_version:'launchwright-extension-driver-result/1',kind,fixture_sha256:fixtureSha,exit_code:0,
    stdout,stderr,stdout_sha256:sha(Buffer.from(stdout)),stderr_sha256:sha(Buffer.from(stderr))
  };
}

test('canonical DeltaRender receipt promotes only exact current Host execution to PASS',async t=>{
  const{app,root,extensionReceiptRoot}=setup(t);
  const fixtureSha=sha(readFileSync('fixtures/deltarender.mjs'));
  const ext=(await execute(app,'extension.register',extensionManifest('deliverable_renderer','DeltaRender','deltarender-request/1','rendered-document/1',fixtureSha))).entity;
  const prep=(await execute(app,'extension.prepare_use',{extension_id:ext.id,name:'Canonical render',purpose:'Owned Host fixture',input_type:'deltarender-request/1',output_type:'rendered-document/1',client_schema_major:1})).entity;
  const request={schema_version:'deltarender-request/1',title:'Release 1.0',body:'Bounded output.'};
  const stdin=JSON.stringify(request);
  const output={schema_version:'deltarender-output/1',format:'markdown',text:'# Release 1.0\n\nBounded output.\n',fidelity:{structure:'exact',interactive_content:false},rights:'owned',renderer:'deltarender-fixture/1'};
  const stdout=JSON.stringify(output)+'\n';
  const report={...common('renderer',fixtureSha,stdout),input_sha256:sha(Buffer.from(stdin)),output_type:'rendered-document/1',output};
  const ref=pin(extensionReceiptRoot,'r28-render.json',envelope(report));
  const native=new ExtensionRuntimeNativeApplication(root,{extensionReceiptRoot});t.after(()=>native.close());
  const stored=native.mutate('extension.result_record',{preparation_id:prep.id,input_sha256:report.input_sha256,output_type:'rendered-document/1',outcome:'SUCCESS',
    started_at:'2026-10-08T00:00:00.000Z',finished_at:'2026-10-08T00:00:00.100Z',output,runtime_receipt:ref}).entity;
  assert.equal(stored.data.technical_state,'PASS');assert.equal(stored.data.host_isolation_verified,true);
  assert.equal(stored.data.runtime_admission.provider,'driver:launchwright-extension');
  const inspected=await execute(app,'extension.result_inspect',{id:stored.id});
  assert.equal(inspected.technical_state,'PASS');assert.equal(inspected.verified_execution,true);assert.equal(inspected.host_isolation_verified,true);
  await execute(app,'extension.retire',{id:ext.id,expected:ext.version,reason:'Drift test'});
  const stale=await execute(app,'extension.result_inspect',{id:stored.id});
  assert.equal(stale.freshness,'REVOKED_EXTENSION');assert.equal(stale.technical_state,'UNKNOWN');assert.equal(stale.host_isolation_verified,true);
});

test('normal application surface cannot self-attach a canonical extension receipt',async t=>{
  const{app,extensionReceiptRoot}=setup(t);
  const fixtureSha=sha(readFileSync('fixtures/deltarender.mjs'));
  const ext=(await execute(app,'extension.register',extensionManifest('deliverable_renderer','DeltaRender','deltarender-request/1','rendered-document/1',fixtureSha))).entity;
  const prep=(await execute(app,'extension.prepare_use',{extension_id:ext.id,name:'No shortcut',purpose:'Reject self admission',input_type:'deltarender-request/1',output_type:'rendered-document/1',client_schema_major:1})).entity;
  const output={schema_version:'deltarender-output/1',format:'markdown',text:'# A\n',fidelity:{structure:'exact',interactive_content:false},rights:'owned',renderer:'deltarender-fixture/1'};
  const stdin='{"body":"x","schema_version":"deltarender-request/1","title":"A"}',stdout=JSON.stringify(output)+'\n';
  const report={...common('renderer',fixtureSha,stdout),input_sha256:sha(Buffer.from(stdin)),output_type:'rendered-document/1',output};
  const ref=pin(extensionReceiptRoot,'r28-shortcut.json',envelope(report));
  await assert.rejects(execute(app,'extension.result_record',{preparation_id:prep.id,input_sha256:report.input_sha256,output_type:'rendered-document/1',outcome:'SUCCESS',
    started_at:'2026-10-08T00:00:00.000Z',finished_at:'2026-10-08T00:00:00.100Z',output,runtime_receipt:ref}),{code:'PolicyDenied'});
});

test('canonical renderer admission rejects output substitution and external authority escalation',async t=>{
  const{app,root,extensionReceiptRoot}=setup(t);
  const fixtureSha=sha(readFileSync('fixtures/deltarender.mjs'));
  const ext=(await execute(app,'extension.register',extensionManifest('deliverable_renderer','DeltaRender','deltarender-request/1','rendered-document/1',fixtureSha))).entity;
  const prep=(await execute(app,'extension.prepare_use',{extension_id:ext.id,name:'Tamper',purpose:'Negative control',input_type:'deltarender-request/1',output_type:'rendered-document/1',client_schema_major:1})).entity;
  const output={schema_version:'deltarender-output/1',format:'markdown',text:'# Exact\n',fidelity:{structure:'exact',interactive_content:false},rights:'owned',renderer:'deltarender-fixture/1'};
  const stdout=JSON.stringify(output)+'\n',inputSha='a'.repeat(64);
  const report={...common('renderer',fixtureSha,stdout),input_sha256:inputSha,output_type:'rendered-document/1',output};
  const native=new ExtensionRuntimeNativeApplication(root,{extensionReceiptRoot});t.after(()=>native.close());
  const tampered={...output,text:'# Substituted\n'};
  const ref=pin(extensionReceiptRoot,'r28-substitution.json',envelope(report));
  assert.throws(()=>native.mutate('extension.result_record',{preparation_id:prep.id,input_sha256:inputSha,output_type:'rendered-document/1',outcome:'SUCCESS',
    started_at:'2026-10-08T00:00:00.000Z',finished_at:'2026-10-08T00:00:00.100Z',output:tampered,runtime_receipt:ref}),{code:'Conflict'});
  const elevated=pin(extensionReceiptRoot,'r28-escalated.json',envelope(report,{platform_execution_authority:true}));
  assert.throws(()=>native.mutate('extension.result_record',{preparation_id:prep.id,input_sha256:inputSha,output_type:'rendered-document/1',outcome:'SUCCESS',
    started_at:'2026-10-08T00:00:00.000Z',finished_at:'2026-10-08T00:00:00.100Z',output,runtime_receipt:elevated}),{code:'Conflict'});
});

test('canonical DeltaCLI status receipt is build-bound and becomes UNKNOWN on adapter retirement',async t=>{
  const{app,root,extensionReceiptRoot}=setup(t),b=await baseline(app);
  const cliSha=sha(readFileSync('fixtures/deltacli.mjs'));
  const ext=(await execute(app,'extension.register',extensionManifest('source_adapter','DeltaCLI','cli-source/1','cli-observation/1',cliSha))).entity;
  const source=(await execute(app,'entity.create',{kind:'source',data:{product_id:b.product.id,name:'DeltaCLI',type:'cli',locator:'repo:fixtures/deltacli.mjs',build:'build-A',coverage:'declared',purpose:'Owned CLI status',approval:'approved'}})).entity;
  const facts={product:'DeltaCLI',build:'build-A',mode:'demo',features:{safe_export:true},items:3},stdout=JSON.stringify(facts)+'\n';
  const report={...common('cli',cliSha,stdout),observed_build:'build-A',facts};
  const ref=pin(extensionReceiptRoot,'r28-cli.json',envelope(report,{observed_at:'2026-10-08T00:00:01.100Z'}));
  const native=new ExtensionRuntimeNativeApplication(root,{extensionReceiptRoot});t.after(()=>native.close());
  const stored=native.mutate('source.cli_ingest',{source_id:source.id,target_id:b.target.id,extension_id:ext.id,
    command:'driver.launchwright-extension.cli-status',args:['status','--json'],observed_build:'build-A',
    started_at:'2026-10-08T00:00:01.000Z',finished_at:'2026-10-08T00:00:01.100Z',exit_code:0,stdout,stderr:'',runtime_receipt:ref}).entity;
  let inspected=await execute(app,'source.cli_inspect',{id:stored.id});
  assert.equal(inspected.technical_state,'PASS');assert.equal(inspected.verified_execution,true);assert.equal(inspected.host_isolation_verified,true);
  await execute(app,'extension.retire',{id:ext.id,expected:ext.version,reason:'Adapter retirement'});
  inspected=await execute(app,'source.cli_inspect',{id:stored.id});
  assert.equal(inspected.freshness,'REVOKED_EXTENSION');assert.equal(inspected.technical_state,'UNKNOWN');assert.equal(inspected.host_isolation_verified,true);
});
