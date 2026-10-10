#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Real WordPress REST owned ephemeral CI fixture. Refuses non-loopback target.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LaunchwrightApplication,execute } from '../src/application.mjs';
import { prepareWordPressDraft,readPrivateWordPressCredentials,
  wordpressHttpTransport,sendWordPressDraft } from '../src/wordpress-draft.mjs';

const [origin,file]=process.argv.slice(2);
if(!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/u.test(origin??'') ||
  !file || process.argv.length!==4){
  process.stderr.write('Owned WordPress CI smoke requires exact http://127.0.0.1:PORT and private credential file.\n');
  process.exit(2);
}
const root=mkdtempSync(join(tmpdir(),'launchwright-r47-owned-wordpress-'));
let app;
try{
  const credentials=readPrivateWordPressCredentials(file);
  app=new LaunchwrightApplication(root,{initialize:true});
  const create=async(kind,data)=>(await execute(app,'entity.create',{kind,data})).entity;
  const product=await create('product',{name:'Owned WordPress fixture',description:'Disposable WordPress CI only'});
  const release=await create('release',{
    product_id:product.id,name:'Owned source version',build:'owned-wp-ci-2026',
    status:'draft'
  });
  const source=await create('source',{
    product_id:product.id,name:'Operator synthetic notes',type:'cli',
    locator:'git-local:owned-wordpress-fixture',build:release.data.build,
    coverage:'declared',approval:'approved',
    purpose:'Only a disposable CI WordPress draft REST test'
  });
  const target=await create('target',{
    release_id:release.id,name:'Synthetic English reviewers',
    ui_locale:'en-US',editorial_locale:'en-US',
    role:'reviewer',plan:'ci-only',region:'US',flags:{},
    viewport:{width:1440,height:900,scale_milli:1000}
  });
  const deliveryInput=await create('deliverable',{
    release_id:release.id,name:'Owned synthetic draft',
    target_id:target.id,format:'markdown',
    content:'Only a synthetic test of WordPress DRAFT transport, no customer product and no publication.',
    claim_ids:[],source_ids:[source.id]
  });
  const artifact=(await execute(app,'deliverable.render',{id:deliveryInput.id})).entity;
  const profile=await create('channel_profile',{
    product_id:product.id,name:'Disposable WordPress draft API',
    channel:'wordpress-post-draft',profile_version:'wp/v2/r47-owned-ci',
    destination_class:'external-draft',requirements:{format:'markdown'},
    source:'wordpress-draft:'+origin,effective_at:'2026-10-09T00:00:00.000Z',
    idempotency:'recover-first'
  });
  const candidate=(await execute(app,'candidate.freeze',{
    release_id:release.id,name:'Owned frozen WordPress draft',
    artifact_ids:[artifact.id],destination:'disposable-wordpress-ci',
    channel_profile_ids:[profile.id],
    contract:{version:'r47-ci',required_reviewers:1,require_claims_verified:false}
  })).entity;
  await execute(app,'candidate.review',{
    id:candidate.id,candidate_sha256:candidate.data.candidate_sha256,
    decision:'approve-editorial',comment:'Owned disposable test approval only'
  });
  const packaged=(await execute(app,'channel.package',{
    candidate_id:candidate.id,profile_id:profile.id,participant:'synthetic-operator',
    locale:'en-US',allow_partial:false,omissions:[]
  })).entity;
  const intent=prepareWordPressDraft(app,{
    delivery_id:packaged.id,origin,title:'Owned launchwright REST DRAFT',
    notes_artifact_id:artifact.id,
    acknowledge_draft_only:true,acknowledge_unverified:true,
    acknowledge_site_control:true,acknowledge_source_rights:true
  });
  const remote=wordpressHttpTransport(origin,credentials);
  const approval={confirm_origin:origin,
    confirm_candidate_sha256:candidate.data.candidate_sha256,
    confirm_intent_sha256:intent.intent_sha256,acknowledge_first_send:true
  };
  const first=await sendWordPressDraft(app,intent,remote,approval);
  if(first.proof.post_status!=='draft'||first.proof.published!==false ||
    first.external_send_performed!==true ||
    first.record.data.external_state!=='DRAFT_CREATED')
    throw Error('Real WordPress REST did not retain private draft proof');
  const recovered=await sendWordPressDraft(app,intent,remote,{
    ...approval,acknowledge_first_send:false,recover_only:true
  });
  if(recovered.proof.post_id!==first.proof.post_id ||
    recovered.record.id!==first.record.id ||
    recovered.external_send_performed!==false ||
    recovered.recovered!==true)
    throw Error('Real WordPress REST recovery was not exactly idempotent');
  process.stdout.write(JSON.stringify({
    schema_version:'launchwright-r47-real-wordpress-owned-fixture/1',
    exact_intent_sha256:intent.intent_sha256,
    exact_markdown_sha256:intent.notes_sha256,
    authenticated_wordpress_http_roundtrip_passed:true,
    real_wordpress_post_draft_created:true,
    original_post_id:first.proof.post_id,
    exact_readback_verified:true,read_only_recovery_verified:true,
    posts_created:1,
    real_customer_website:false,live_production_credentials_used:false,
    post_published:false,platform_authority:false,
    operator_editorial_fixture_only:true,
    independent_customer_acceptance:false
  },null,2)+'\n');
}finally{
  try{app?.close();}finally{rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});}
}
