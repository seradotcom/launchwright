#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { LaunchwrightApplication, execute } from '../src/application.mjs';

const evidence=resolve(process.env.LAUNCHWRIGHT_EFFECTS_EVIDENCE??'evidence/effects');
const context=JSON.parse(readFileSync(resolve(evidence,'context.json'),'utf8'));
const specText=readFileSync(resolve(evidence,'spec.json'),'utf8');
const resultText=readFileSync(resolve(evidence,'result.json'),'utf8').trim();
const app=new LaunchwrightApplication(context.state_root,{capabilities:{canonical_effect_admission:true}});
try{
  const recorded=await execute(app,'effects.record',{release_id:context.release_id,artifact_ids:[context.artifact_id],spec_text:specText,result_text:resultText,admit:true});
  const status=await execute(app,'effects.inspect',{release_id:context.release_id});
  assert.equal(recorded.entity.data.admission,'canonical-owner-admitted');
  assert.equal(recorded.entity.data.execution_authority,false);
  assert.equal(status.state,'PASS');
  assert.equal(status.canonical_passes,1);
  assert.equal(status.receipts[0].current,true);
  assert.equal(status.scenario_effects_authority,false);
  const report={schema_version:'launchwright-effects-acceptance/1',result_sha256:recorded.entity.data.result_sha256,artifact_sha256:context.artifact_sha256,effective_verdict:status.state,canonical_readback_scope:status.scope,execution_authority:false,scenario_effects_authority:false,host_acceptance:false};
  writeFileSync(resolve(evidence,'launchwright-effects-acceptance.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
}finally{app.close();}
