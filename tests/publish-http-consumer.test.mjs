// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAppServer, loadConsumerAuth } from '../src/server.mjs';
import { execute } from '../src/application.mjs';
import { LaunchwrightClient } from '../client/index.mjs';
import { setup, baseline } from './helpers.mjs';

const consumerFixture=fileURLToPath(new URL('../fixtures/publish-consumer.mjs',import.meta.url));
function runConsumer(env){
  return new Promise((resolve,reject)=>{
    const inherited=Object.fromEntries(['PATH','Path','SystemRoot','WINDIR','TEMP','TMP'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
    const child=spawn(process.execPath,[consumerFixture],{env:{...inherited,...env},stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);
    child.once('error',reject);child.once('close',code=>code===0?resolve(JSON.parse(stdout)):reject(new Error(`consumer exited ${code}: ${stderr}`)));
  });
}
async function publication(app,b){
  const scenario=(await execute(app,'entity.create',{kind:'scenario',data:{release_id:b.release.id,name:'HTTP publish flow',source_id:b.source.id,target_id:b.target.id,readiness:'declared',anchors:[{name:'root',role:'main',label:'Workspace',expected_count:1}],steps:[{action:'assert',anchor:'root'}]}})).entity;
  const claim=(await execute(app,'entity.create',{kind:'claim',data:{release_id:b.release.id,name:'HTTP publish claim',text:'Synthetic bounded claim',target_id:b.target.id,category:'editorial',evidence_ids:[]}})).entity;
  const data={
    product_id:b.product.id,release_id:b.release.id,name:'HTTP consumer product',description:'Separate consumer fixture',source_types:['web'],source_ids:[b.source.id],scenario_ids:[scenario.id],protected_scenario_ids:[scenario.id],claim_ids:[claim.id],
    locales:['en-US'],destinations:['private-download'],outputs:['artifact'],parameters:[{name:'brand',type:'text',required:true,max_length:80},{name:'flow',type:'resource',required:true,resource_kind:'scenario',options:[{value:'primary',resource_id:scenario.id}]},{name:'locale',type:'choice',required:true,choices:['en-US']}],verification_dimensions:['format'],budget:{max_cost_microunits:5000,currency:'USD',max_runtime_seconds:120},audience:'invited',external_disclosures:['Synthetic test only'],export_resource_ids:[b.source.id,scenario.id,claim.id],result_retention:{mode:'preserve'}
  };
  const template=(await execute(app,'publish.template_create',{data})).entity;
  const version=(await execute(app,'publish.version_freeze',{template_id:template.id,template_version:template.version,version_label:'http-1'})).entity;
  const deployment=(await execute(app,'publish.deployment_create',{product_version_id:version.id,name:'HTTP consumer deployment'})).entity;
  return{scenario,claim,data,template,version,deployment};
}

test('R7 separate process consumes a private ProductVersion over public HTTP without owner workspace authority',async t=>{
  const{app}=setup(t),b=await baseline(app),p=await publication(app,b);
  const service=createAppServer(app,{port:0,token:'synthetic-owner-token-0001',bearerPrincipals:[
    {token:'synthetic-consumer-token-a',principal:'client-a',scopes:['consume']},
    {token:'synthetic-consumer-token-b',principal:'client-b',scopes:['consume']}
  ]});
  const baseUrl=await service.listen();t.after(()=>service.close());
  const result=await runConsumer({LAUNCHWRIGHT_URL:baseUrl,LAUNCHWRIGHT_CONSUMER_TOKEN:'synthetic-consumer-token-a',LAUNCHWRIGHT_DEPLOYMENT_ID:p.deployment.id,LAUNCHWRIGHT_OWNER_RESOURCE_ID:p.scenario.id});
  assert.equal(result.owner_resources_exposed,false);assert.equal(result.owner_read_denied,true);assert.equal(result.consumer,'client-a');
  assert.equal(result.deduplicated_second,true);assert.equal(result.same_invocation,true);assert.equal(result.same_work,true);
  assert.equal(app.list('publish_invocation').length,1);assert.equal(app.list('work').filter(w=>w.data.publication_binding?.kind==='publish_invocation').length,1);
  const firstConsumer=new LaunchwrightClient({baseUrl,token:'synthetic-consumer-token-a'});
  const other=new LaunchwrightClient({baseUrl,token:'synthetic-consumer-token-b'});
  const protectedInput={deployment_id:p.deployment.id,invocation_key:'principal-bound-attempt',parameters:{brand:'Principal bound',flow:'primary',locale:'en-US'},budget:{max_cost_microunits:1000,currency:'USD',max_runtime_seconds:60},requested_outputs:['artifact']};
  const principalBound=await firstConsumer.prepare('publish.invoke_prepare',protectedInput,{key:'principal-bound-http-request'});
  assert.equal(principalBound.principal,'client-a');assert.equal(principalBound.schema_version,'launchwright-prepared/2');
  await assert.rejects(other.sendPrepared(principalBound),{code:'PermissionDenied'});
  const accepted=await firstConsumer.sendPrepared(principalBound);assert.equal(accepted.entity.data.consumer,'client-a');
  const recovered=await firstConsumer.recover(principalBound);assert.equal(recovered.state,'recorded');assert.equal(recovered.result.entity.id,accepted.entity.id);
  await assert.rejects(other.recover(principalBound),{code:'Conflict'});
  assert.equal(app.list('publish_invocation').length,2);assert.equal(app.list('work').filter(w=>w.data.publication_binding?.kind==='publish_invocation').length,2);
  await assert.rejects(other.publishInspect({invocation_id:result.invocation_id}),{code:'PermissionDenied'});
  const publicView=await other.publishInspect({deployment_id:p.deployment.id});
  assert.equal(publicView.owner_resources_exposed,false);assert.equal(publicView.product_version.contract.parameters.find(x=>x.name==='flow').options[0].resource_id,undefined);
  const pinnedDigest=publicView.product_version.product_version_digest;
  await execute(app,'publish.template_update',{id:p.template.id,expected:p.template.version,data:{...p.data,name:'HTTP consumer product edited after freeze'}});
  const afterTemplateEdit=await firstConsumer.publishInspect({deployment_id:p.deployment.id});assert.equal(afterTemplateEdit.product_version.product_version_digest,pinnedDigest);assert.equal(afterTemplateEdit.product_version.name,p.version.data.name);
  const deprecated=(await execute(app,'publish.deployment_transition',{id:p.deployment.id,expected:p.deployment.version,state:'DEPRECATED',reason:'R7 lifecycle rehearsal'})).entity;
  assert.equal((await firstConsumer.publishInspect({deployment_id:p.deployment.id})).deployment.state,'DEPRECATED');
  const retired=(await execute(app,'publish.deployment_transition',{id:deprecated.id,expected:deprecated.version,state:'RETIRED',reason:'R7 lifecycle rehearsal complete'})).entity;assert.equal(retired.data.new_invocations_allowed,false);
  assert.equal((await firstConsumer.publishInspect({invocation_id:result.invocation_id})).invocation.invocation_digest,result.invocation_digest);
  await assert.rejects(firstConsumer.mutate('publish.invoke_prepare',{...protectedInput,invocation_key:'after-retirement'}),{code:'Conflict'});
  assert.equal(app.list('publish_invocation').length,2);
  const login=await fetch(baseUrl+'/api/v1/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:'synthetic-consumer-token-a'})});
  assert.equal(login.status,403);assert.equal(login.headers.get('set-cookie'),null);
  assert.equal((await fetch(other.artifactUrl('artifact_missing'),{headers:{Authorization:'Bearer synthetic-consumer-token-b'}})).status,403);
});

test('consumer bearer configuration loads only bounded private files and rejects ambiguous authority',async t=>{
  const{app,root}=setup(t),path=join(root,'fixture.consumer-auth.json');
  writeFileSync(path,JSON.stringify({schema_version:'launchwright-consumer-auth/1',principals:[{token:'synthetic-consumer-token-file',principal:'client-file',scopes:['consume']}]}),{mode:0o600});
  assert.equal(loadConsumerAuth(path)[0].principal,'client-file');
  if(process.platform!=='win32'){chmodSync(path,0o644);assert.throws(()=>loadConsumerAuth(path),{code:'PermissionDenied'});chmodSync(path,0o600);}
  assert.throws(()=>createAppServer(app,{token:'synthetic-owner-token-0002',bearerPrincipals:[{token:'synthetic-owner-token-0002',principal:'client-a',scopes:['consume']}]}),{code:'Conflict'});
  assert.throws(()=>createAppServer(app,{token:'synthetic-owner-token-0002',bearerPrincipals:[{token:'synthetic-consumer-token-c',principal:'client-a',scopes:['consume']},{token:'synthetic-consumer-token-d',principal:'client-a',scopes:['consume']}]}),{code:'Conflict'});
  assert.throws(()=>createAppServer(app,{token:'synthetic-owner-token-0002',bearerPrincipals:[{token:'synthetic-consumer-token-e',principal:'client-e',scopes:['superuser']}]}),{code:'InvalidArgument'});
  assert.throws(()=>createAppServer(app,{token:'synthetic-owner-token-0002',bearerPrincipals:[{token:'synthetic-consumer-token-f',principal:'client-f',scopes:['read']}]}),{code:'InvalidArgument'});
});
