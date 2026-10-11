// SPDX-License-Identifier: AGPL-3.0-only
// R70 owned two-release Native-only editorial fixture, never executes a
// source application, uploads private files or publishes any material.
import {baseline} from './helpers.mjs';
import {execute} from '../src/application.mjs';

export async function makeCarryForwardFixture(app){
  const old=await baseline(app);
  const artifact=(await execute(app,'deliverable.render',{
    id:old.deliverable.id
  })).entity;
  const candidate=(await execute(app,'candidate.freeze',{
    release_id:old.release.id,name:'Owned historical frozen Markdown',
    artifact_ids:[artifact.id],destination:'private-r70-review',
    contract:{version:'r70-fixture',required_reviewers:1,
      require_claims_verified:false}
  })).entity;
  await execute(app,'candidate.review',{
    id:candidate.id,candidate_sha256:candidate.data.candidate_sha256,
    decision:'approve-editorial',
    comment:'Human-approved historical fixture; NOT approved for a new build'
  });
  const release=(await execute(app,'entity.create',{kind:'release',data:{
    product_id:old.product.id,name:'Owned build B draft',build:'owned-build-B',
    status:'draft'
  }})).entity;
  const target=(await execute(app,'entity.create',{kind:'target',data:{
    ...old.target.data,release_id:release.id
  }})).entity;
  const input={
    source_candidate_id:candidate.id,source_artifact_id:artifact.id,
    destination_release_id:release.id,destination_target_id:target.id,
    destination_name:'Release notes',
    acknowledge_historical_rights:true,
    acknowledge_editorial_recheck:true
  };
  return{old,artifact,candidate,release,target,input};
}
