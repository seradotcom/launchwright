// SPDX-License-Identifier: AGPL-3.0-only
// Owned R71 fixture: actual canonical Native SDK/SQLite release records.
// Three frozen Markdown artifacts; no third-party app execution.
import {makeCarryForwardFixture} from './carry-forward-fixture.mjs';
import {execute} from '../src/application.mjs';

export async function makeBatchFixture(app){
  const original=await makeCarryForwardFixture(app);
  const {old,release,target}=original;
  const second=(await execute(app,'entity.create',{
    kind:'deliverable',data:{
      release_id:old.release.id,target_id:old.target.id,
      name:'Migration guide',format:'markdown',
      content:'## Old migration guide\n\nOperator-owned synthetic migration notes.',
      claim_ids:[],source_ids:[old.source.id]
    }
  })).entity;
  const third=(await execute(app,'entity.create',{
    kind:'deliverable',data:{
      release_id:old.release.id,target_id:old.target.id,
      name:'Support FAQ',format:'markdown',
      content:'## Historical FAQ\n\nNot validated for the next build.',
      claim_ids:[],source_ids:[old.source.id]
    }
  })).entity;
  const secondArt=(await execute(app,'deliverable.render',{id:second.id})).entity;
  const thirdArt=(await execute(app,'deliverable.render',{id:third.id})).entity;
  const candidate=(await execute(app,'candidate.freeze',{
    release_id:old.release.id,name:'Three reviewed historical documents',
    artifact_ids:[original.artifact.id,secondArt.id,thirdArt.id],
    destination:'owned-batch-review',
    contract:{version:'r71-batch-fixture',required_reviewers:1,
      require_claims_verified:false}
  })).entity;
  await execute(app,'candidate.review',{
    id:candidate.id,candidate_sha256:candidate.data.candidate_sha256,
    decision:'approve-editorial',
    comment:'Owned synthetic historical review; new builds remain UNKNOWN'
  });
  const selections=[
    {source_artifact_id:original.artifact.id,
      destination_target_id:target.id,destination_name:'Notes to re-review'},
    {source_artifact_id:secondArt.id,
      destination_target_id:target.id,destination_name:'Migration to re-review'}
  ];
  return{
    ...original,second,third,secondArt,thirdArt,candidate,
    selections,input:{
      source_candidate_id:candidate.id,destination_release_id:release.id,
      items:selections,
      acknowledge_historical_rights:true,
      acknowledge_editorial_recheck:true
    }
  };
}
