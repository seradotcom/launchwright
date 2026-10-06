// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { execute } from '../src/application.mjs';
import { setup, baseline, update } from './helpers.mjs';

const fixture=fileURLToPath(new URL('../fixtures/deltacli.mjs',import.meta.url));
const manifest=()=>({name:'DeltaCLI source adapter',type:'source_adapter',package_version:'1.0.0',schema_major:1,digest:'e'.repeat(64),license:'AGPL-3.0-only',rights:'owned',source:'repo:fixtures/deltacli-adapter',permissions:['read','capture'],inputs:['cli-source/1'],outputs:['cli-observation/1'],preconditions:['approved-source'],evidence:['process-receipt'],limits:{max_input_bytes:4096,max_output_bytes:65536,timeout_seconds:10}});

test('extension preparation pins exact package and retirement blocks new starts without deleting history', async t=>{
  const {app}=setup(t);
  const ext=(await execute(app,'extension.register',manifest())).entity;
  const view=await execute(app,'extension.generic_view',{id:ext.id});
  assert.equal(view.trusted_markup,false);
  assert.equal(view.remote_code_execution,false);
  assert.deepEqual(view.allowed_actions,[]);
  assert.equal(view.authority,'descriptor-metadata-does-not-grant-capability');

  const prep=(await execute(app,'extension.prepare_use',{extension_id:ext.id,name:'CLI release observation',purpose:'Observe owned fixture',input_type:'cli-source/1',output_type:'cli-observation/1',client_schema_major:1})).entity;
  let status=await execute(app,'extension.preparation_status',{id:prep.id});
  assert.equal(status.state,'CURRENT');
  assert.equal(status.start_allowed,true);

  const retired=await execute(app,'extension.retire',{id:ext.id,expected:ext.version,reason:'Reference revocation rehearsal'});
  assert.deepEqual(retired.affected_preparations,[prep.id]);
  status=await execute(app,'extension.preparation_status',{id:prep.id});
  assert.equal(status.state,'REVOKED_FOR_NEW_START');
  assert.equal(status.start_allowed,false);
  assert.equal(status.historical_record_preserved,true);
  await assert.rejects(execute(app,'extension.prepare_use',{extension_id:ext.id,name:'Blocked',purpose:'Must fail',input_type:'cli-source/1',output_type:'cli-observation/1',client_schema_major:1}),{code:'Conflict'});
});

test('extension descriptor rejects executable metadata', async t=>{
  const {app}=setup(t);
  await assert.rejects(execute(app,'extension.register',{...manifest(),source:'javascript:alert(1)'}));
  await assert.rejects(execute(app,'extension.register',{...manifest(),name:'<script>bad</script>'}));
});

test('real CLI fixture is observed as a non-DOM source and never promoted to Host PASS', async t=>{
  const {app}=setup(t);
  const b=await baseline(app);
  const source=await b.create('source',{product_id:b.product.id,name:'DeltaCLI',type:'cli',locator:'repo:fixtures/deltacli.mjs',build:'build-A',coverage:'declared',purpose:'Owned CLI fixture for release observation',approval:'approved'});
  const ext=(await execute(app,'extension.register',manifest())).entity;
  const run=spawnSync(process.execPath,[fixture,'status','--json'],{encoding:'utf8',env:{...process.env,DELTACLI_BUILD:'build-A'}});
  assert.equal(run.status,0);
  const facts=JSON.parse(run.stdout);
  assert.equal(facts.product,'DeltaCLI');
  assert.equal(facts.build,'build-A');
  const start=new Date(Date.now()-20).toISOString(),finish=new Date().toISOString();
  const obs=(await execute(app,'source.cli_ingest',{source_id:source.id,target_id:b.target.id,extension_id:ext.id,command:'node fixtures/deltacli.mjs',args:['status','--json'],observed_build:facts.build,started_at:start,finished_at:finish,exit_code:run.status,stdout:run.stdout,stderr:run.stderr})).entity;
  assert.equal(obs.data.process_outcome,'SUCCESS');
  assert.equal(obs.data.technical_state,'UNKNOWN');
  assert.equal(obs.data.host_isolation_verified,false);
  let inspected=await execute(app,'source.cli_inspect',{id:obs.id});
  assert.equal(inspected.freshness,'CURRENT');
  assert.equal(inspected.technical_state,'UNKNOWN');

  await execute(app,'extension.retire',{id:ext.id,expected:ext.version,reason:'Revoke adapter after recorded observation'});
  inspected=await execute(app,'source.cli_inspect',{id:obs.id});
  assert.equal(inspected.freshness,'REVOKED_EXTENSION');
  assert.ok(inspected.reasons.includes('extension-retired'));
  assert.equal(inspected.observation.id,obs.id);

  const changed=(await update(app,source,{...source.data,purpose:'Owned CLI fixture for release observation v2'})).entity;
  assert.notDeepEqual(changed.version,source.version);
  inspected=await execute(app,'source.cli_inspect',{id:obs.id});
  assert.ok(inspected.reasons.includes('source-revision-changed'));
});

test('CLI receipt rejects build drift and secret-bearing flags', async t=>{
  const {app}=setup(t);const b=await baseline(app);
  const source=await b.create('source',{product_id:b.product.id,name:'DeltaCLI',type:'cli',locator:'repo:fixtures/deltacli.mjs',build:'build-A',coverage:'declared',purpose:'Owned CLI fixture',approval:'approved'});
  const ext=(await execute(app,'extension.register',manifest())).entity;
  const base={source_id:source.id,target_id:b.target.id,extension_id:ext.id,command:'deltacli',args:['status','--json'],observed_build:'build-B',started_at:new Date(Date.now()-10).toISOString(),finished_at:new Date().toISOString(),exit_code:0,stdout:'{}',stderr:''};
  await assert.rejects(execute(app,'source.cli_ingest',base),{code:'StaleReference'});
  await assert.rejects(execute(app,'source.cli_ingest',{...base,observed_build:'build-A',args:['--token=secret']}));
});
