// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { execute } from '../src/application.mjs';
import { setup, baseline, update } from './helpers.mjs';

const channelData=productId=>({
  product_id:productId,name:'Pinned docs portal',channel:'docs-review',profile_version:'2026-10-05',
  destination_class:'external-draft',requirements:{format:'json'},source:'operator-contract:docs-review',
  effective_at:'2026-10-05T00:00:00.000Z',idempotency:'recover-first'
});

let verifierSequence=0;
async function protectedCandidate(app,b,{allowPartial=false,requiredDimensions=[],requiredReviewers=1,requireClaimsVerified=false}={}){
  let verifierProfile=null;
  if(requiredDimensions.length){
    const n=++verifierSequence;
    verifierProfile=(await execute(app,'extension.register',{
      name:'Protected candidate verifier '+n,type:'verifier_profile',package_version:'1.0.'+n,schema_major:1,
      digest:'c'.repeat(64),license:'AGPL-3.0-only',source:'repo:synthetic/candidate-verifier-'+n,
      permissions:['read','review'],inputs:['candidate/2'],outputs:['verification-report/1'],preconditions:['candidate-frozen'],
      evidence:['negative-controls'],limits:{max_input_bytes:8192,max_output_bytes:8192,timeout_seconds:10},
      verifier:{dimensions:requiredDimensions,authority:'canonical',negative_controls:true,coverage_mode:'complete',
        negative_control_cases:requiredDimensions.map((dimension,index)=>({id:dimension+'-negative-'+n,dimension,kind:index%2?'wrong-price':'wrong-screen',fixture_sha256:((index%8)+1).toString().repeat(64),expected_outcome:'DETECTED'}))}
    })).entity;
  }
  const artifact=(await execute(app,'deliverable.render',{id:b.deliverable.id})).entity;
  const contract=await b.create('release_contract',{release_id:b.release.id,name:'Pinned release contract',required_claim_ids:[],optional_claim_ids:[],required_deliverable_ids:[b.deliverable.id]});
  const profile=await b.create('channel_profile',channelData(b.product.id));
  const evidence=(await execute(app,'evidence.import',{
    release_id:b.release.id,target_id:b.target.id,source_id:b.source.id,name:'Licensed product source',
    build:b.release.data.build,classification:'actual',rights:'licensed',description:'Synthetic licensed fixture',
    origin_digest:'a'.repeat(64)
  })).entity;
  const candidate=(await execute(app,'candidate.freeze',{
    release_id:b.release.id,name:'Protected candidate',artifact_ids:[artifact.id],destination:'release-draft',
    release_contract_id:contract.id,channel_profile_ids:[profile.id],rights_evidence_ids:[evidence.id],verifier_profile_ids:verifierProfile?[verifierProfile.id]:[],
    contract:{version:'v2',required_reviewers:requiredReviewers,require_claims_verified:requireClaimsVerified,required_verification_dimensions:requiredDimensions,allow_partial_delivery:allowPartial}
  })).entity;
  return{artifact,contract,profile,evidence,verifierProfile,candidate};
}

test('candidate v2 seals target, contract, channel and rights references into its digest',async t=>{
  const {app}=setup(t);const b=await baseline(app),f=await protectedCandidate(app,b,{requiredDimensions:['format','rights']});
  const m=f.candidate.data.manifest;
  assert.equal(m.schema_version,'launchwright-candidate/2');
  assert.deepEqual(m.release_contract,{id:f.contract.id,version:f.contract.version});
  assert.equal(m.target_contexts.length,1);assert.equal(m.target_contexts[0].id,b.target.id);assert.match(m.target_contexts[0].fingerprint_sha256,/^[0-9a-f]{64}$/);
  assert.deepEqual(m.channel_profiles.map(p=>p.id),[f.profile.id]);
  assert.deepEqual(m.rights.map(r=>[r.id,r.rights]),[[f.evidence.id,'licensed']]);
  assert.equal(m.verifier_profiles.length,1);assert.equal(m.verifier_profiles[0].id,f.verifierProfile.id);assert.deepEqual(m.verifier_profiles[0].dimensions,['format','rights']);assert.equal(m.verifier_profiles[0].negative_control_cases.length,2);
  for(const id of [b.release.id,b.target.id,f.contract.id,f.profile.id,f.evidence.id])assert.ok(m.inputs.some(pin=>pin.id===id),id);
  const inspected=await execute(app,'candidate.inspect',{id:f.candidate.id});
  assert.equal(inspected.gates.find(g=>g.name==='release-contract').state,'PASS');
  assert.equal(inspected.gates.find(g=>g.name==='channel-profiles').state,'PASS');
  assert.equal(inspected.gates.find(g=>g.name==='declared-rights').state,'PASS');
  assert.equal(inspected.gates.find(g=>g.name==='verification-records').state,'UNKNOWN');
  assert.equal(inspected.readiness.review,'READY_FOR_REVIEW');
  assert.equal(inspected.readiness.published,'NOT_OBSERVED');
  assert.equal(inspected.external_publication_allowed,false);
});

test('changing a protected ReleaseContract or ChannelProfile invalidates the frozen candidate',async t=>{
  const {app}=setup(t);const b=await baseline(app),f=await protectedCandidate(app,b);
  await update(app,f.contract,{name:'Changed contract after freeze'});
  let inspected=await execute(app,'candidate.inspect',{id:f.candidate.id});
  assert.equal(inspected.fresh,false);
  assert.equal(inspected.gates.find(g=>g.name==='input-versions').state,'FAIL');
  assert.equal(inspected.gates.find(g=>g.name==='release-contract').state,'FAIL');
  await assert.rejects(execute(app,'channel.package',{candidate_id:f.candidate.id,profile_id:f.profile.id,participant:'reviewer',locale:'en-US',allow_partial:false,omissions:[]}),{code:'StaleReference'});

  const fresh=await protectedCandidate(app,b);
  await update(app,fresh.profile,{profile_version:'2026-10-06'});
  inspected=await execute(app,'candidate.inspect',{id:fresh.candidate.id});
  assert.equal(inspected.fresh,false);
  await assert.rejects(execute(app,'channel.package',{candidate_id:fresh.candidate.id,profile_id:fresh.profile.id,participant:'reviewer',locale:'en-US',allow_partial:false,omissions:[]}),{code:'StaleReference'});
});

test('partial channel package requires candidate policy and explicit omissions',async t=>{
  const {app}=setup(t);const b=await baseline(app),blocked=await protectedCandidate(app,b);
  await assert.rejects(execute(app,'channel.package',{candidate_id:blocked.candidate.id,profile_id:blocked.profile.id,participant:'reviewer',locale:'en-US',allow_partial:true,omissions:['es-MX']}),{code:'ConsentRequired'});
  const allowed=await protectedCandidate(app,b,{allowPartial:true});
  await assert.rejects(execute(app,'channel.package',{candidate_id:allowed.candidate.id,profile_id:allowed.profile.id,participant:'reviewer',locale:'en-US',allow_partial:true,omissions:[]}),{code:'InvalidArgument'});
  const packaged=(await execute(app,'channel.package',{candidate_id:allowed.candidate.id,profile_id:allowed.profile.id,participant:'reviewer',locale:'en-US',allow_partial:true,omissions:['es-MX not included in this draft']})).entity;
  assert.equal(packaged.data.partial,true);assert.deepEqual(packaged.data.omissions,['es-MX not included in this draft']);
});

test('candidate pins localization source and glossary revisions without fabricating final-language PASS',async t=>{
  const {app}=setup(t);const b=await baseline(app);
  const claim=await b.create('claim',{release_id:b.release.id,name:'Localized claim',text:'Launch securely',target_id:b.target.id,category:'editorial',subject:'launch',scope:'release-copy',owner:'release-team',evidence_ids:[]});
  const copy=await b.create('copy_block',{release_id:b.release.id,name:'English copy',target_id:b.target.id,claim_id:claim.id,locale:'en-US',content:'Launch securely',owner:'human'});
  const arabic=await b.create('target',{release_id:b.release.id,name:'Arabic basic',ui_locale:'en-US',editorial_locale:'ar-SA',role:'viewer',plan:'basic',region:'MX',flags:{advanced_export:false},viewport:{width:1440,height:900,scale_milli:1000}});
  const glossary=await b.create('glossary',{product_id:b.product.id,name:'Arabic launch terms',source_locale:'en-US',target_locale:'ar-SA',version_label:'1',terms:[{source:'Launch',target:'إطلاق',critical:true}],owner:'human',status:'active'});
  const localized=(await execute(app,'localization.create',{release_id:b.release.id,target_id:arabic.id,source_copy_block_id:copy.id,glossary_id:glossary.id,name:'Arabic copy',locale:'ar-SA',direction:'rtl',fallback_policy:'block',content:'إطلاق آمن',owner:'human',status:'HUMAN_EDITED',font_refs:[]})).entity;
  const localizedDeliverable=await b.create('deliverable',{release_id:b.release.id,name:'Arabic notes',target_id:arabic.id,format:'markdown',content:'إطلاق آمن',claim_ids:[],source_ids:[b.source.id]});
  const artifact=(await execute(app,'deliverable.render',{id:localizedDeliverable.id})).entity;
  const candidate=(await execute(app,'candidate.freeze',{
    release_id:b.release.id,name:'Localized candidate',artifact_ids:[artifact.id],destination:'arabic-review',
    localized_copy_ids:[localized.id],contract:{version:'v2',required_reviewers:1,require_claims_verified:false}
  })).entity;
  let inspected=await execute(app,'candidate.inspect',{id:candidate.id});
  const localizationGate=inspected.gates.find(g=>g.name==='localization');
  assert.equal(localizationGate.state,'UNKNOWN');
  assert.equal(localizationGate.details[0].final_layout_verified,false);
  assert.equal(localizationGate.details[0].professional_language_quality_verified,false);
  assert.equal(inspected.external_publication_allowed,false);

  await update(app,copy,{content:'Launch securely today'});
  inspected=await execute(app,'candidate.inspect',{id:candidate.id});
  assert.equal(inspected.fresh,false);
  assert.equal(inspected.gates.find(g=>g.name==='localization').state,'FAIL');
  assert.ok(inspected.gates.find(g=>g.name==='localization').details[0].reasons.includes('STALE_SOURCE'));
});


test('late review for an older candidate never approves a newer candidate',async t=>{
  const {app}=setup(t);const b=await baseline(app);
  const first=await protectedCandidate(app,b),second=await protectedCandidate(app,b);
  await execute(app,'candidate.review',{id:first.candidate.id,candidate_sha256:first.candidate.data.candidate_sha256,decision:'approve-editorial',comment:'Approve only candidate one'});
  const one=await execute(app,'candidate.inspect',{id:first.candidate.id});
  const two=await execute(app,'candidate.inspect',{id:second.candidate.id});
  assert.equal(one.editorial_review.state,'APPROVED_EDITORIAL');
  assert.equal(two.editorial_review.state,'PENDING');
  assert.equal(two.editorial_review.approvals,0);
});

test('latest decision from a reviewer supersedes that reviewer without deleting history',async t=>{
  const {app}=setup(t);const b=await baseline(app),f=await protectedCandidate(app,b);
  await execute(app,'candidate.review',{id:f.candidate.id,candidate_sha256:f.candidate.data.candidate_sha256,decision:'request-changes',comment:'Fix wording'});
  let inspected=await execute(app,'candidate.inspect',{id:f.candidate.id});
  assert.equal(inspected.editorial_review.state,'BLOCKED');
  await execute(app,'candidate.review',{id:f.candidate.id,candidate_sha256:f.candidate.data.candidate_sha256,decision:'approve-editorial',comment:'Wording accepted'});
  inspected=await execute(app,'candidate.inspect',{id:f.candidate.id});
  assert.equal(inspected.editorial_review.state,'APPROVED_EDITORIAL');
  assert.equal(inspected.reviews.length,2);
  assert.equal(inspected.editorial_review.latest.length,1);
  assert.equal(inspected.editorial_review.latest[0].data.decision,'approve-editorial');
});

test('review refuses a candidate after any protected input changes',async t=>{
  const {app}=setup(t);const b=await baseline(app),f=await protectedCandidate(app,b);
  await update(app,f.contract,{name:'Contract changed while reviewer was reading'});
  await assert.rejects(execute(app,'candidate.review',{id:f.candidate.id,candidate_sha256:f.candidate.data.candidate_sha256,decision:'approve-editorial',comment:'Late approval'}),{code:'StaleReference'});
  const inspected=await execute(app,'candidate.inspect',{id:f.candidate.id});
  assert.equal(inspected.editorial_review.state,'PENDING');
  assert.equal(inspected.readiness.review,'BLOCKED');
});

test('editorial quorum counts distinct latest reviewer identities',async t=>{
  const {app,root}=setup(t),b=await baseline(app),f=await protectedCandidate(app,b,{requiredReviewers:2});
  await execute(app,'candidate.review',{id:f.candidate.id,candidate_sha256:f.candidate.data.candidate_sha256,decision:'approve-editorial',comment:'Owner approval'});
  let inspected=await execute(app,'candidate.inspect',{id:f.candidate.id});
  assert.equal(inspected.editorial_review.state,'PENDING');
  const reviewer=new app.constructor(root,{principal:'reviewer-b',scopes:['read','review']});
  t.after(()=>{try{reviewer.close();}catch{}});
  await execute(reviewer,'candidate.review',{id:f.candidate.id,candidate_sha256:f.candidate.data.candidate_sha256,decision:'approve-editorial',comment:'Second independent editorial approval'});
  inspected=await execute(app,'candidate.inspect',{id:f.candidate.id});
  assert.equal(inspected.editorial_review.state,'APPROVED_EDITORIAL');
  assert.equal(inspected.editorial_review.approvals,2);
  assert.deepEqual(new Set(inspected.editorial_review.latest.map(review=>review.data.reviewer)),new Set(['local-owner','reviewer-b']));
});
