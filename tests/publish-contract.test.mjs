import test from 'node:test';
import assert from 'node:assert/strict';
import { LaunchwrightApplication, execute } from '../src/application.mjs';
import { runPlatformWork } from '../src/platform.mjs';
import { setup, baseline } from './helpers.mjs';

async function publishFixture(app,b,label='A'){
  const scenario=(await execute(app,'entity.create',{kind:'scenario',data:{
    release_id:b.release.id,name:'Publish flow '+label,source_id:b.source.id,target_id:b.target.id,
    readiness:'declared',anchors:[{name:'root',role:'main',label:'Workspace',expected_count:1}],
    steps:[{action:'assert',anchor:'root'}]
  }})).entity;
  const claim=(await execute(app,'entity.create',{kind:'claim',data:{
    release_id:b.release.id,name:'Publish claim '+label,text:'Synthetic bounded claim',target_id:b.target.id,category:'editorial',evidence_ids:[]
  }})).entity;
  const data={
    product_id:b.product.id,release_id:b.release.id,name:'Release product '+label,description:'Synthetic reusable release product',
    source_types:['web'],source_ids:[b.source.id],scenario_ids:[scenario.id],protected_scenario_ids:[scenario.id],claim_ids:[claim.id],
    locales:['en-US','es-MX'],destinations:['private-download'],outputs:['artifact','media-screenshots'],
    parameters:[
      {name:'brand',type:'text',required:true,max_length:80},
      {name:'flow',type:'resource',required:true,resource_kind:'scenario',options:[{value:'primary',resource_id:scenario.id}]},
      {name:'locale',type:'choice',required:true,choices:['en-US','es-MX']}
    ],
    verification_dimensions:['format','product-evidence'],
    budget:{max_cost_microunits:5000,currency:'USD',max_runtime_seconds:120},
    audience:'invited',external_disclosures:['Synthetic test only'],
    export_resource_ids:[b.source.id,scenario.id,claim.id],result_retention:{mode:'preserve'}
  };
  const template=(await execute(app,'publish.template_create',{data})).entity;
  const version=(await execute(app,'publish.version_freeze',{template_id:template.id,template_version:template.version,version_label:'1.0-'+label})).entity;
  const deployment=(await execute(app,'publish.deployment_create',{product_version_id:version.id,name:'Deployment '+label})).entity;
  return{scenario,claim,data,template,version,deployment};
}
const invokeInput=(deployment,key='attempt-1',patch={})=>({
  deployment_id:deployment.id,invocation_key:key,
  parameters:{brand:'Acme',flow:'primary',locale:'en-US'},
  budget:{max_cost_microunits:1000,currency:'USD',max_runtime_seconds:60},
  requested_outputs:['artifact'],...patch
});

test('RS-PUB-01/04 ReleaseTemplate drafts remain editable while ProductVersion and deployment stay pinned',async t=>{
  const{app}=setup(t),b=await baseline(app),p=await publishFixture(app,b);
  const digest=p.version.data.product_version_digest,templatePin=p.version.data.release_template_version;
  const changed=(await execute(app,'publish.template_update',{id:p.template.id,expected:p.template.version,data:{...p.data,name:'Release product edited'}})).entity;
  assert.notDeepEqual(changed.version,p.template.version);
  const inspected=await execute(app,'publish.inspect',{deployment_id:p.deployment.id});
  assert.equal(inspected.product_version.product_version_digest,digest);
  assert.deepEqual(app.get(p.version.id).data.release_template_version,templatePin);
  assert.equal(inspected.deployment.product_version_digest,digest);
});

test('RS-PUB-02 rejects URL/path semantics, out-of-scope values and direct publish.invoke work preparation',async t=>{
  const{app}=setup(t),b=await baseline(app),p=await publishFixture(app,b);
  const consumer=new LaunchwrightApplication(app.store.root,{principal:'client-a',scopes:['consume']});t.after(()=>consumer.close());
  await assert.rejects(execute(consumer,'publish.invoke_prepare',invokeInput(p.deployment,'url',{parameters:{brand:'https://outside.test',flow:'primary',locale:'en-US'}})),{code:'PermissionDenied'});
  await assert.rejects(execute(consumer,'publish.invoke_prepare',invokeInput(p.deployment,'flow',{parameters:{brand:'Acme',flow:'not-authorized',locale:'en-US'}})),{code:'PermissionDenied'});
  await assert.rejects(execute(app,'work.prepare',{release_id:b.release.id,name:'Bypass',action:'publish.invoke',arguments:{invocation_id:'publish_invocation_fake'},budget:{max_cost_microunits:0,currency:'USD',max_runtime_seconds:1},authorization:'explicit-publication'}),{code:'PermissionDenied'});
  assert.equal(app.list('publish_invocation').length,0);
});

test('RS-PUB-03/05 consumer scope can use the product without owner workspace read and consumers cannot inspect each other invocations',async t=>{
  const{app,root}=setup(t),b=await baseline(app),p=await publishFixture(app,b);
  const a=new LaunchwrightApplication(root,{principal:'client-a',scopes:['consume']});
  const c=new LaunchwrightApplication(root,{principal:'client-b',scopes:['consume']});t.after(()=>a.close());t.after(()=>c.close());
  const prepared=await execute(a,'publish.invoke_prepare',invokeInput(p.deployment));
  assert.equal(prepared.entity.data.consumer,'client-a');
  assert.equal(prepared.entity.data.resolved_parameters.flow,p.scenario.id);
  assert.equal((await execute(a,'publish.inspect',{invocation_id:prepared.entity.id})).invocation.parameters.flow,'primary');
  await assert.rejects(execute(a,'resource.get',{id:p.scenario.id}),{code:'PermissionDenied'});
  await assert.rejects(execute(c,'publish.inspect',{invocation_id:prepared.entity.id}),{code:'PermissionDenied'});
  const publicView=await execute(c,'publish.inspect',{deployment_id:p.deployment.id});
  assert.equal(publicView.owner_resources_exposed,false);
  assert.equal(publicView.product_version.contract.parameters.find(x=>x.name==='flow').options[0].resource_id,undefined);
});

test('RS-PUB-07 same consumer attempt key deduplicates invocation and work while conflicting input fails',async t=>{
  const{app,root}=setup(t),b=await baseline(app),p=await publishFixture(app,b);
  const consumer=new LaunchwrightApplication(root,{principal:'client-a',scopes:['consume']});t.after(()=>consumer.close());
  const first=await execute(consumer,'publish.invoke_prepare',invokeInput(p.deployment,'stable-key'));
  const second=await execute(consumer,'publish.invoke_prepare',invokeInput(p.deployment,'stable-key'));
  assert.equal(second.deduplicated,true);assert.equal(second.entity.id,first.entity.id);assert.equal(second.work.id,first.work.id);
  assert.equal(app.list('publish_invocation').length,1);
  assert.equal(app.list('work').filter(w=>w.data.publication_binding?.id===first.entity.id).length,1);
  await assert.rejects(execute(consumer,'publish.invoke_prepare',invokeInput(p.deployment,'stable-key',{parameters:{brand:'Other',flow:'primary',locale:'en-US'}})),{code:'Conflict'});
});

test('RS-PUB-06 retirement blocks new invocations but preserves prior result custody and inspection',async t=>{
  const{app,root}=setup(t),b=await baseline(app),p=await publishFixture(app,b);
  const consumer=new LaunchwrightApplication(root,{principal:'client-a',scopes:['consume']});t.after(()=>consumer.close());
  const before=await execute(consumer,'publish.invoke_prepare',invokeInput(p.deployment,'before-retire'));
  const retired=(await execute(app,'publish.deployment_transition',{id:p.deployment.id,expected:p.deployment.version,state:'RETIRED',reason:'Synthetic lifecycle close'})).entity;
  assert.equal(retired.data.new_invocations_allowed,false);
  assert.equal((await execute(consumer,'publish.inspect',{invocation_id:before.entity.id})).invocation.invocation_digest,before.entity.data.invocation_digest);
  await assert.rejects(execute(consumer,'publish.invoke_prepare',invokeInput(retired,'after-retire')),{code:'Conflict'});
});

test('RS-PUB-08 export excludes authority and import requires explicit local rebind/recheck',async t=>{
  const{app}=setup(t),a=await baseline(app),pa=await publishFixture(app,a,'A');
  const exported=await execute(app,'publish.export',{product_version_id:pa.version.id});
  assert.equal(exported.manifest.secrets_included,false);assert.equal(exported.manifest.grants_included,false);assert.equal(exported.manifest.permissions_included,false);
  const b=await baseline(app),pb=await publishFixture(app,b,'B');
  await assert.rejects(execute(app,'publish.import',{product_id:b.product.id,release_id:b.release.id,name:'Imported',manifest:exported.manifest,bindings:{}}),{code:'Conflict'});
  const bindings={
    [a.source.id]:b.source.id,
    [pa.scenario.id]:pb.scenario.id,
    [pa.claim.id]:pb.claim.id
  };
  const imported=await execute(app,'publish.import',{product_id:b.product.id,release_id:b.release.id,name:'Imported',manifest:exported.manifest,bindings});
  assert.equal(imported.reverification_required,true);
  await assert.rejects(execute(app,'publish.version_freeze',{template_id:imported.entity.id,template_version:imported.entity.version,version_label:'imported-1'}),{code:'PolicyDenied'});
  const rebound=(await execute(app,'publish.import_rebind',{id:imported.entity.id,expected:imported.entity.version,acknowledge_contract_recheck:true})).entity;
  const frozen=(await execute(app,'publish.version_freeze',{template_id:rebound.id,template_version:rebound.version,version_label:'imported-1'})).entity;
  assert.equal(frozen.data.product_id,b.product.id);assert.equal(frozen.data.platform_publish_authority,'EXTERNAL');
});

test('RS-PUB-01/07 canonical Platform adapter accepts only an exact bound publication intent and sends it once',async t=>{
  const{app}=setup(t),b=await baseline(app),p=await publishFixture(app,b);
  const work=(await execute(app,'work.prepare',{release_id:b.release.id,name:'Define product',action:'publish.define',arguments:{release_template_id:p.template.id},budget:{max_cost_microunits:0,currency:'USD',max_runtime_seconds:60},authorization:'explicit-publication'})).entity;
  let sends=0;
  const client={
    async verifyIdentity(){return{ok:true};},async negotiate(){return{ok:true};},
    prepareRequest(action,args){return{schema_version:'synthetic-platform-pending/1',action,args};},
    exportPending(record){return JSON.stringify(record);},
    async sendPrepared(){sends++;return{job_id:'synthetic-publish-job'};},
    async recover(){throw Error('not used');}
  };
  const done=await runPlatformWork(app,work.id,{client});
  assert.equal(sends,1);assert.equal(done.entity.data.platform_job_id,'synthetic-publish-job');
  await assert.rejects(runPlatformWork(app,work.id,{client}),{code:'Conflict'});assert.equal(sends,1);
});

test('RS-PUB-04 bound outbound work becomes stale if its deployment lifecycle changes before send',async t=>{
  const{app}=setup(t),b=await baseline(app),p=await publishFixture(app,b);
  const work=(await execute(app,'work.prepare',{release_id:b.release.id,name:'Deploy product',action:'publish.deploy',arguments:{deployment_id:p.deployment.id},budget:{max_cost_microunits:0,currency:'USD',max_runtime_seconds:60},authorization:'explicit-publication'})).entity;
  await execute(app,'publish.deployment_transition',{id:p.deployment.id,expected:p.deployment.version,state:'DEPRECATED',reason:'Synthetic update'});
  let sends=0;const client={async verifyIdentity(){},async negotiate(){},prepareRequest(){return{};},exportPending(r){return JSON.stringify(r);},async sendPrepared(){sends++;return{};}};
  await assert.rejects(runPlatformWork(app,work.id,{client}),{code:'StaleReference'});assert.equal(sends,0);
});


test('R30 Publish contracts can require credential-pattern scan without silently replacing privacy',async t=>{
  const{app}=setup(t),b=await baseline(app),p=await publishFixture(app,b);
  const dimensions=['format','credential-exposure','privacy'];
  const updated=(await execute(app,'publish.template_update',{
    id:p.template.id,expected:p.template.version,data:{...p.data,verification_dimensions:dimensions}
  })).entity;
  assert.deepEqual(updated.data.verification_dimensions,dimensions);
  const version=(await execute(app,'publish.version_freeze',{
    template_id:updated.id,template_version:updated.version,version_label:'credential-bound'
  })).entity;
  assert.deepEqual(version.data.contract.verification_dimensions,dimensions);
});
