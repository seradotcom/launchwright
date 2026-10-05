import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LaunchwrightApplication, execute } from '../src/application.mjs';
export function setup(t,options={}){const root=mkdtempSync(join(tmpdir(),'launchwright-test-'));let app=new LaunchwrightApplication(root,{initialize:true,...options});t.after(()=>{try{app.close();}catch{}rmSync(root,{recursive:true,force:true});});return{app,root};}
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
