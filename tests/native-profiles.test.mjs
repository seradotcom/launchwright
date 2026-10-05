// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchApplication, applicationContext } from '@semwright/native-sdk';
import { makeRequest } from '../src/base.mjs';
import { nativeDriverName } from '../src/native-profile-base.mjs';
import { CoreNativeApplication } from '../src/native-core-app.mjs';
import { ProductionNativeApplication } from '../src/native-production-app.mjs';
import { ReviewNativeApplication } from '../src/native-review-app.mjs';
import { IntegrationsNativeApplication } from '../src/native-integrations-app.mjs';
import { WorkNativeApplication } from '../src/native-work-app.mjs';
import { setup, baseline } from './helpers.mjs';

async function invokeProfile(Profile,root,operation,input){
  const app=new Profile(root);
  try{
    const expected=app.store.version(),epoch=app.store.meta().epoch;
    const args=makeRequest(operation,input,expected,epoch);
    return await dispatchApplication(
      app,'invoke',nativeDriverName(operation),
      {ref:'synthetic-reference-already-bound-by-host',...args},
      applicationContext(args.request.key,expected)
    );
  }finally{app.close();}
}

test('split native profiles preserve canonical mutation transactions across one workspace',async t=>{
  const seeded=setup(t),b=await baseline(seeded.app);
  seeded.app.close();

  const core=await invokeProfile(CoreNativeApplication,seeded.root,'entity.create',{kind:'product',data:{name:'Native profile product',description:'Synthetic profile test'}});
  assert.equal(core.entity.kind,'product');

  const production=await invokeProfile(ProductionNativeApplication,seeded.root,'deliverable.render',{id:b.deliverable.id});
  assert.equal(production.entity.kind,'artifact');
  assert.equal(production.entity.data.deliverable_id,b.deliverable.id);

  const review=await invokeProfile(ReviewNativeApplication,seeded.root,'candidate.freeze',{
    release_id:b.release.id,name:'Native profile candidate',artifact_ids:[production.entity.id],destination:'native-profile-draft',
    contract:{version:'v1',required_reviewers:1,require_claims_verified:false}
  });
  assert.equal(review.entity.kind,'candidate');

  const manifest={name:'Native profile adapter',type:'source_adapter',package_version:'1.0.0',schema_major:1,digest:'e'.repeat(64),license:'AGPL-3.0-only',source:'repo:synthetic/native-profile-adapter',permissions:['read'],inputs:['source-contract/1'],outputs:['capture-receipt/1'],preconditions:['approved-source'],evidence:['operation-receipt'],limits:{max_input_bytes:4096,max_output_bytes:4096,timeout_seconds:10}};
  const integration=await invokeProfile(IntegrationsNativeApplication,seeded.root,'extension.register',manifest);
  assert.equal(integration.entity.kind,'extension_package');
  assert.equal(integration.entity.data.remote_code_executable,false);

  const work=await invokeProfile(WorkNativeApplication,seeded.root,'work.prepare',{
    release_id:b.release.id,name:'Native profile work',action:'graph.observe',arguments:{project:'synthetic'},
    budget:{max_cost_microunits:0,currency:'USD',max_runtime_seconds:30}
  });
  assert.equal(work.entity.kind,'work');
  assert.equal(work.entity.data.state,'PREPARED');
});
