// SPDX-License-Identifier: AGPL-3.0-only
// Owned synthetic data ONLY; does not execute any source application.
import { execute } from '../src/application.mjs';
import { baseline } from './helpers.mjs';
export async function createR67Fixture(app){
  const old=await baseline(app);
  const artA=(await execute(app,'deliverable.render',{id:old.deliverable.id})).entity;
  const before=(await execute(app,'candidate.freeze',{
    release_id:old.release.id,name:'R67 earlier candidate',artifact_ids:[artA.id],
    destination:'private-r67-test',contract:{version:'r67-test',required_reviewers:1,
      require_claims_verified:false}
  })).entity;
  await execute(app,'candidate.review',{id:before.id,
    candidate_sha256:before.data.candidate_sha256,
    decision:'approve-editorial',comment:'Owned synthetic R67 release A'});
  const afterRelease=await old.create('release',{
    product_id:old.product.id,name:'R67 second release',build:'build-B',status:'draft'
  });
  const source=await old.create('source',{
    product_id:old.product.id,name:'Second owned source',type:'web',
    locator:'http://127.0.0.1:4320/build/B',build:'build-B',coverage:'declared'
  });
  const target=await old.create('target',{
    release_id:afterRelease.id,name:'English basic',ui_locale:'en-US',
    editorial_locale:'en-US',role:'viewer',plan:'basic',region:'MX',
    flags:{advanced_export:false},viewport:{width:1440,height:900,scale_milli:1000}
  });
  const doc=await old.create('deliverable',{
    release_id:afterRelease.id,target_id:target.id,name:'Release notes',
    format:'markdown',content:'Owned synthetic editorial copy.',
    claim_ids:[],source_ids:[source.id]
  });
  const artB=(await execute(app,'deliverable.render',{id:doc.id})).entity;
  const after=(await execute(app,'candidate.freeze',{
    release_id:afterRelease.id,name:'R67 newer candidate',artifact_ids:[artB.id],
    destination:'private-r67-test',contract:{version:'r67-test',required_reviewers:1,
      require_claims_verified:false}
  })).entity;
  await execute(app,'candidate.review',{id:after.id,
    candidate_sha256:after.data.candidate_sha256,
    decision:'approve-editorial',comment:'Owned synthetic R67 release B'});
  const selection={
    before_release_id:old.release.id,after_release_id:afterRelease.id,
    before_candidate_id:before.id,after_candidate_id:after.id,
    acknowledge_private_only:true,acknowledge_incomplete_coverage:true
  };
  return{old,before,after,afterRelease,doc,selection};
}
