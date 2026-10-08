import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LaunchwrightApplication, execute } from '../src/application.mjs';

const temporaryRoots = new Set();
process.once('exit',()=>{
  for(const root of temporaryRoots){
    try{rmSync(root,{recursive:true,force:true,maxRetries:8,retryDelay:50});}catch{}
  }
});

export function setup(t,options={}){
  const root=mkdtempSync(join(tmpdir(),'launchwright-test-'));
  temporaryRoots.add(root);
  const verificationReceiptRoot=options.verificationReceiptRoot??join(root,'verification-receipts');
  const extensionReceiptRoot=options.extensionReceiptRoot??join(root,'extension-receipts');
  const effectsReceiptRoot=options.effectsReceiptRoot??join(root,'effects-receipts');
  mkdirSync(verificationReceiptRoot,{recursive:true});mkdirSync(extensionReceiptRoot,{recursive:true});mkdirSync(effectsReceiptRoot,{recursive:true});
  const app=new LaunchwrightApplication(root,{initialize:true,...options,verificationReceiptRoot});
  // Node's test after hooks are FIFO. Close the primary handle here, but remove the
  // directory only at process exit so later-registered secondary SQLite handles can close.
  t.after(()=>{try{app.close();}catch{}});
  return{app,root,verificationReceiptRoot,extensionReceiptRoot,effectsReceiptRoot};
}
export async function baseline(app){
 const create=async(kind,data)=>(await execute(app,'entity.create',{kind,data})).entity;
 const product=await create('product',{name:'Synthetic DeltaDesk',description:'Owned test data'});
 const release=await create('release',{product_id:product.id,name:'1.0',build:'build-A',status:'draft'});
 const source=await create('source',{product_id:product.id,name:'Owned fixture',type:'web',locator:'http://127.0.0.1:4320/build/A',build:'build-A',coverage:'declared'});
 const target=await create('target',{release_id:release.id,name:'English basic',ui_locale:'en-US',editorial_locale:'en-US',role:'viewer',plan:'basic',region:'MX',flags:{advanced_export:false},viewport:{width:1440,height:900,scale_milli:1000}});
 const deliverable=await create('deliverable',{release_id:release.id,name:'Release notes',target_id:target.id,format:'markdown',content:'Owned synthetic editorial copy.',claim_ids:[],source_ids:[source.id]});
 return{product,release,source,target,deliverable,create};
}
export async function candidate(app,b){const artifact=(await execute(app,'deliverable.render',{id:b.deliverable.id})).entity;const c=(await execute(app,'candidate.freeze',{release_id:b.release.id,name:'Review A',artifact_ids:[artifact.id],destination:'release-draft',contract:{version:'v1',required_reviewers:1,require_claims_verified:true}})).entity;return{artifact,candidate:c};}
export async function review(app,c,decision='approve-editorial'){return execute(app,'candidate.review',{id:c.id,candidate_sha256:c.data.candidate_sha256,decision,comment:'Synthetic editorial review'});}
export const update=(app,e,patch)=>execute(app,'entity.update',{id:e.id,expected:e.version,data:{...e.data,...patch}});

export function captureInput(b,source,scenario,overrides={}){
  const base={
    release_id:b.release.id,target_id:b.target.id,source_id:source.id,scenario_id:scenario.id,
    name:'Owned capture receipt',build:b.release.data.build,classification:'demo',rights:'owned',
    started_at:'2026-10-04T20:00:00.000Z',finished_at:'2026-10-04T20:00:01.000Z',
    receipt:{
      authority:'semwright-native-driver',provider:'browser',provider_version:'fixture',operation_id:'op-1',profile:'owned-browser',
      platform_job_id:'job-fixture-1',native_receipt_sha256:'a'.repeat(64),
      build_observation:b.release.data.build,build_before:b.release.data.build,build_after:b.release.data.build,outcome:'SUCCEEDED'
    },
    readiness:{state:'READY',checks:[{name:'expected-state',state:'PASS'},{name:'resources',state:'PASS'},{name:'no-blocking-loader',state:'PASS'}]},
    anchors:scenario.data.anchors.map(anchor=>({name:anchor.name,observed_matches:anchor.expected_count,source:'accessible'})),
    isolation:{context_id:'fixture-context-1',auth_scope:'run-scoped',mutable_state:true,tenant_scope:'fixture-tenant'},
    cleanup:{policy:'owned-resources-only',created_resource_ids:['fixture-record-1'],removed_resource_ids:['fixture-record-1']},
    provenance:{capture_class:'CAPTURED_DEMO_DATA',synthetic:true,transformations:[]},
    observations:[{kind:'anchor',key:'root',value:'1 match',source:'accessible'}]
  };
  return{
    ...base,...overrides,
    receipt:{...base.receipt,...(overrides.receipt??{})},
    readiness:{...base.readiness,...(overrides.readiness??{})},
    isolation:{...base.isolation,...(overrides.isolation??{})},
    cleanup:{...base.cleanup,...(overrides.cleanup??{})},
    provenance:{...base.provenance,...(overrides.provenance??{})}
  };
}
