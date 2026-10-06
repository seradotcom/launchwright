// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execute } from '../src/application.mjs';
import { setup, baseline } from './helpers.mjs';

const renderer=fileURLToPath(new URL('../fixtures/deltarender.mjs',import.meta.url));
const mobileImporter=fileURLToPath(new URL('../fixtures/mobile-importer.mjs',import.meta.url));
const mobileBundle=fileURLToPath(new URL('../fixtures/mobile-bundle.json',import.meta.url));
const sha=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');

function manifest(type,name,inputType,outputType,rights='owned'){
  return{name,type,package_version:'1.0.0',schema_major:1,digest:sha(name+'|1.0.0'),license:'AGPL-3.0-only',rights,source:'repo:fixtures/'+name.toLowerCase().replaceAll(' ','-'),
    permissions:['read','capture'],inputs:[inputType],outputs:[outputType],preconditions:['approved-fixture'],evidence:['process-receipt'],
    limits:{max_input_bytes:65536,max_output_bytes:65536,timeout_seconds:10}};
}

test('RS-EXT-07 real deliverable renderer records a bounded generic result and retirement preserves history',async t=>{
  const{app}=setup(t);
  const ext=(await execute(app,'extension.register',manifest('deliverable_renderer','DeltaRender','deltarender-request/1','rendered-document/1'))).entity;
  const prep=(await execute(app,'extension.prepare_use',{extension_id:ext.id,name:'Render release note',purpose:'Owned deterministic renderer fixture',input_type:'deltarender-request/1',output_type:'rendered-document/1',client_schema_major:1})).entity;
  const request={schema_version:'deltarender-request/1',title:'Release 1.0',body:'A bounded renderer result.'};
  const run=spawnSync(process.execPath,[renderer],{input:JSON.stringify(request),encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  const output=JSON.parse(run.stdout);
  assert.equal(output.format,'markdown');assert.equal(output.rights,'owned');assert.match(output.text,/Release 1.0/);
  const result=(await execute(app,'extension.result_record',{preparation_id:prep.id,input_sha256:sha(request),output_type:'rendered-document/1',outcome:'SUCCESS',started_at:new Date(Date.now()-10).toISOString(),finished_at:new Date().toISOString(),output})).entity;
  assert.equal(result.data.process_outcome,'SUCCESS');assert.equal(result.data.technical_state,'UNKNOWN');assert.equal(result.data.host_isolation_verified,false);
  let inspected=await execute(app,'extension.result_inspect',{id:result.id});assert.equal(inspected.freshness,'CURRENT');assert.equal(inspected.verified_execution,false);
  await execute(app,'extension.retire',{id:ext.id,expected:ext.version,reason:'Renderer retirement rehearsal'});
  inspected=await execute(app,'extension.result_inspect',{id:result.id});assert.equal(inspected.freshness,'REVOKED_EXTENSION');assert.equal(inspected.result.id,result.id);
  await assert.rejects(execute(app,'extension.prepare_use',{extension_id:ext.id,name:'Blocked render',purpose:'Must not start',input_type:'deltarender-request/1',output_type:'rendered-document/1',client_schema_major:1}),{code:'Conflict'});
});

test('MOBILE_IMPORT profile uses a real bounded importer and never claims device capture',async t=>{
  const{app}=setup(t),b=await baseline(app);
  const source=(await execute(app,'entity.create',{kind:'source',data:{product_id:b.product.id,name:'Mobile bundle',type:'mobile-import',locator:'fixture:mobile-bundle.json',build:'build-A',coverage:'declared',purpose:'Owned mobile import fixture',approval:'approved'}})).entity;
  const preflight=await execute(app,'profile.preflight',{profile:'mobile-import',source_id:source.id,target_id:b.target.id});
  assert.equal(preflight.import_only,true);assert.equal(preflight.ready_for_native_execution,false);assert.equal(preflight.checks.find(x=>x.name==='source-type').state,'PASS');
  const ext=(await execute(app,'extension.register',manifest('source_adapter','MobileImporter','mobile-bundle/1','mobile-import-observation/1'))).entity;
  const prep=(await execute(app,'extension.prepare_use',{extension_id:ext.id,name:'Import mobile fixture',purpose:'Normalize provided mobile bundle',input_type:'mobile-bundle/1',output_type:'mobile-import-observation/1',client_schema_major:1})).entity;
  const input=readFileSync(mobileBundle,'utf8'),run=spawnSync(process.execPath,[mobileImporter],{input,encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);const output=JSON.parse(run.stdout);
  assert.equal(output.profile,'mobile-import');assert.equal(output.device_execution_observed,false);assert.equal(output.capture_authority,'IMPORTED_UNVERIFIED');assert.equal(output.files.length,2);
  const result=(await execute(app,'extension.result_record',{preparation_id:prep.id,input_sha256:sha(input),output_type:'mobile-import-observation/1',outcome:'SUCCESS',started_at:new Date(Date.now()-10).toISOString(),finished_at:new Date().toISOString(),output})).entity;
  assert.equal(result.data.output.device_execution_observed,false);assert.equal((await execute(app,'extension.result_inspect',{id:result.id})).freshness,'CURRENT');
});

test('extension rights are visible and unresolved rights block prepared use',async t=>{
  const{app}=setup(t);
  const ext=(await execute(app,'extension.register',manifest('deliverable_renderer','UnknownRights','input/1','output/1','unresolved'))).entity;
  const view=await execute(app,'extension.generic_view',{id:ext.id});assert.equal(view.rights,'unresolved');assert.equal(view.remote_code_execution,false);
  await assert.rejects(execute(app,'extension.prepare_use',{extension_id:ext.id,name:'Blocked',purpose:'No rights',input_type:'input/1',output_type:'output/1',client_schema_major:1}),{code:'PolicyDenied'});
});

test('generic result rejects output type substitution and output beyond package budget',async t=>{
  const{app}=setup(t);
  const m=manifest('deliverable_renderer','TinyRenderer','input/1','output/1');m.limits.max_output_bytes=64;
  const ext=(await execute(app,'extension.register',m)).entity;
  const prep=(await execute(app,'extension.prepare_use',{extension_id:ext.id,name:'Tiny',purpose:'Budget test',input_type:'input/1',output_type:'output/1',client_schema_major:1})).entity;
  const base={preparation_id:prep.id,input_sha256:'a'.repeat(64),outcome:'SUCCESS',started_at:new Date(Date.now()-10).toISOString(),finished_at:new Date().toISOString()};
  await assert.rejects(execute(app,'extension.result_record',{...base,output_type:'other/1',output:{ok:true}}),{code:'ProtocolMismatch'});
  await assert.rejects(execute(app,'extension.result_record',{...base,output_type:'output/1',output:{text:'x'.repeat(100)}}),{code:'ResourceExhausted'});
});
