#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LaunchwrightApplication, execute } from '../src/application.mjs';

const evidence=resolve(process.env.LAUNCHWRIGHT_EFFECTS_EVIDENCE??'evidence/effects');
const state=resolve(evidence,'state'),artifacts=resolve(evidence,'artifacts');
rmSync(state,{recursive:true,force:true});rmSync(artifacts,{recursive:true,force:true});
mkdirSync(state,{recursive:true});mkdirSync(artifacts,{recursive:true});
const app=new LaunchwrightApplication(state,{initialize:true});
try{
  const create=async(kind,data)=>(await execute(app,'entity.create',{kind,data})).entity;
  const product=await create('product',{name:'Owned Effects Acceptance'});
  const release=await create('release',{product_id:product.id,name:'effects-r12',build:'build-A',status:'draft'});
  const source=await create('source',{product_id:product.id,name:'Owned source',type:'document',locator:'owned://effects-fixture',build:'build-A',coverage:'declared'});
  const target=await create('target',{release_id:release.id,name:'Owned target',ui_locale:'en-US',editorial_locale:'en-US',role:'owner',plan:'test',region:'CI',flags:{},viewport:{width:1280,height:720,scale_milli:1000}});
  const deliverable=await create('deliverable',{release_id:release.id,name:'Effects acceptance JSON',target_id:target.id,format:'json',content:'Owned deterministic Effects acceptance artifact.',claim_ids:[],source_ids:[source.id]});
  const artifact=(await execute(app,'deliverable.render',{id:deliverable.id})).entity;
  const read=await execute(app,'artifact.read',{id:artifact.id});
  const bytes=Buffer.from(read.text,'utf8');
  writeFileSync(resolve(artifacts,'release.json'),bytes);
  const definition={
    owner:{session:'launchwright_effects_r12',principal:{named:'launchwright_owner'}},
    request_id:'launchwright_effects_r12',
    source_digest:'4'.repeat(64),runtime_digest:'5'.repeat(64),
    declared_producer_execution_status:'unknown',
    application_roots:[state],
    artifacts:[{slot:'release',path:'release.json',sha256:artifact.data.sha256,bytes:bytes.length,mime_type:'application/json'}],
    checks:[
      {id:'draft',artifact_slot:'release',selector:{kind:'json',pointer:'/draft',scalar:{kind:'bool'}},predicate:{kind:'equals',expected:{kind:'bool',value:true}}},
      {id:'build',artifact_slot:'release',selector:{kind:'json',pointer:'/release/build',scalar:{kind:'text'}},predicate:{kind:'equals',expected:{kind:'text',value:'build-A'}}}
    ]
  };
  writeFileSync(resolve(evidence,'definition.json'),JSON.stringify(definition,null,2)+'\n');
  writeFileSync(resolve(evidence,'context.json'),JSON.stringify({state_root:state,release_id:release.id,artifact_id:artifact.id,artifact_sha256:artifact.data.sha256},null,2)+'\n');
  console.log(JSON.stringify({prepared:true,release_id:release.id,artifact_id:artifact.id,artifact_sha256:artifact.data.sha256,artifact_bytes:bytes.length}));
}finally{app.close();}
