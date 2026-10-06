// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { LaunchwrightApplication, execute } from '../src/application.mjs';

const state=mkdtempSync(join(tmpdir(),'launchwright-bundle-'));
const app=new LaunchwrightApplication(state,{initialize:true});
const product=(await execute(app,'entity.create',{kind:'product',data:{name:'Native bundle smoke',description:'Synthetic local fixture'}})).entity;
const release=(await execute(app,'entity.create',{kind:'release',data:{product_id:product.id,name:'0.0-smoke',build:'smoke-build',status:'draft'}})).entity;
const candidate=app.store.create('candidate',{release_id:release.id,name:'Synthetic bundle smoke candidate'});
const source=(await execute(app,'entity.create',{kind:'source',data:{product_id:product.id,name:'Synthetic publish source',type:'web',locator:'http://127.0.0.1:4320/build/smoke',build:'smoke-build',coverage:'declared'}})).entity;
const target=(await execute(app,'entity.create',{kind:'target',data:{release_id:release.id,name:'Synthetic publish target',ui_locale:'en-US',editorial_locale:'en-US',role:'viewer',plan:'basic',region:'MX',flags:{},viewport:{width:1280,height:720,scale_milli:1000}}})).entity;
const scenario=(await execute(app,'entity.create',{kind:'scenario',data:{release_id:release.id,name:'Synthetic publish flow',source_id:source.id,target_id:target.id,readiness:'declared',anchors:[{name:'root',role:'main',label:'Workspace',expected_count:1}],steps:[{action:'assert',anchor:'root'}]}})).entity;
const claim=(await execute(app,'entity.create',{kind:'claim',data:{release_id:release.id,name:'Synthetic publish claim',text:'Synthetic bounded claim',target_id:target.id,category:'editorial',evidence_ids:[]}})).entity;
const template=(await execute(app,'publish.template_create',{data:{
  product_id:product.id,release_id:release.id,name:'Synthetic publish product',description:'Bundle smoke publication contract',
  source_types:['web'],source_ids:[source.id],scenario_ids:[scenario.id],protected_scenario_ids:[scenario.id],claim_ids:[claim.id],
  locales:['en-US'],destinations:['private-download'],outputs:['artifact'],
  parameters:[{name:'brand',type:'text',required:true,max_length:80}],
  verification_dimensions:['format'],budget:{max_cost_microunits:1000,currency:'USD',max_runtime_seconds:60},
  audience:'private',external_disclosures:['Synthetic smoke only'],export_resource_ids:[source.id,scenario.id,claim.id],result_retention:{mode:'preserve'}
}})).entity;
const productVersion=(await execute(app,'publish.version_freeze',{template_id:template.id,template_version:template.version,version_label:'smoke-1'})).entity;
const deployment=(await execute(app,'publish.deployment_create',{product_version_id:productVersion.id,name:'Synthetic smoke deployment'})).entity;
app.close();

const manifest=JSON.parse(readFileSync('dist/native-bundle.json','utf8'));
const reads={
  core:['workspace-describe',{}],
  production:['release-coverage',{release_id:release.id}],
  review:['verification-summary',{candidate_id:candidate.id}],
  integrations:['channel-status',{release_id:release.id}],
  extensions:['compatibility-negotiate',{schema_major:1}],
  work:['workspace-snapshot',{}],
  media:['media-inspect',{}],
  publish:['publish-inspect',{deployment_id:deployment.id}]
};
const results={};

for(const [profile,[suffix,input]] of Object.entries(reads)){
  const meta=manifest.profiles[profile];
  assert.ok(meta,profile+' manifest');
  const bytes=readFileSync('dist/'+meta.file);
  assert.equal(bytes.length,meta.bytes,profile+' bytes');
  assert.equal(createHash('sha256').update(bytes).digest('hex'),meta.sha256,profile+' sha256');
  assert.ok(bytes.length<=48*1024,profile+' NodeBridge MAX_BUNDLE');
  const frame={
    schema_version:'semwright-native-app-bridge/1',id:'bundle-smoke-'+profile,
    method:'invoke',operation:'driver.launchwright.'+suffix,
    args:{ref:'synthetic-reference-already-bound-by-host',input},expected:null,
    runtime:{data_root:state,output_root:null}
  };
  const stdin=bytes.toString('utf8')+'\nvoid module.exports.semwrightNativeBridgeMain(JSON.parse('+JSON.stringify(JSON.stringify(frame))+'));\n';
  assert.ok(Buffer.byteLength(stdin)<=64*1024,profile+' combined stdin budget');
  const run=spawnSync(process.execPath,['--input-type=commonjs','-'],{input:stdin,encoding:'utf8'});
  assert.equal(run.status,0,profile+': '+run.stderr);
  const reply=JSON.parse(run.stdout.trim());
  assert.equal(reply.schema_version,frame.schema_version,profile);
  assert.equal(reply.ok,true,profile+': '+JSON.stringify(reply.error));
  results[profile]={sha256:meta.sha256,bytes:meta.bytes,operation:frame.operation};
}

mkdirSync('evidence/native',{recursive:true});
writeFileSync('evidence/native/bundle-smoke.json',JSON.stringify({
  passed:true,source_sha:process.env.GITHUB_SHA??null,
  schema_version:manifest.schema_version,profiles:results,
  canonical_bridge_reply:'semwright-native-app-bridge/1',
  driver_host_isolation_accepted:false
},null,2)+'\n');
rmSync(state,{recursive:true,force:true});
