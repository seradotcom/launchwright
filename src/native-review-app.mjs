// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import { NativeError, requireCondition as ensure, sameVersion } from '@semwright/native-sdk';
import { NativeProfileApplication } from './native-profile-base.mjs';
import { inputObject, sha, choice, lines } from './contracts.mjs';
import { iso } from './base.mjs';
import { validateVerification, validateWaiver, validateChannelPackage, validateChannelOutcome } from './records.mjs';
import { claimCheck } from './claim-check.mjs';
import { freezeCandidate, buildCandidateGates, inspectCandidateState, recordCandidateReview, assertPrivateDeliveryReady, assertChannelPinned, assertPartialDeliveryPolicy } from './candidate.mjs';

export const REVIEW_NATIVE_READS=Object.freeze(['candidate.inspect','verification.summary']);
export const REVIEW_NATIVE_MUTATIONS=Object.freeze([
  'verification.record','waiver.record','candidate.freeze','candidate.review',
  'candidate.deliver_private','channel.package','channel.record_outcome'
]);
export const REVIEW_NATIVE_OPERATIONS=Object.freeze([...REVIEW_NATIVE_READS,...REVIEW_NATIVE_MUTATIONS]);

export class ReviewNativeApplication extends NativeProfileApplication {
  constructor(root,options={}){super(root,{...options,readOperations:REVIEW_NATIVE_READS,operations:REVIEW_NATIVE_OPERATIONS});}
  claimCheck(claim){return claimCheck(this,claim);}
  verificationSummary(candidateId){
    const candidate=this.get(candidateId,'candidate');
    const records=this.list('verification',candidate.data.release_id).filter(v=>v.data.candidate_id===candidate.id);
    const waivers=this.list('waiver',candidate.data.release_id).filter(w=>w.data.candidate_id===candidate.id);
    const checks=records.map(v=>{
      const related=waivers.filter(w=>w.data.verification_id===v.id),active=related.filter(w=>!w.data.expires_at||Date.parse(w.data.expires_at)>Date.now());
      const admitted=v.data.admission==='canonical-owner-admitted',effective=v.data.state==='FAIL'||v.data.state==='ERROR'?v.data.state:(admitted?v.data.state:'UNKNOWN');
      return{verification_id:v.id,dimension:v.data.dimension,reported_state:v.data.state,effective_state:effective,admission:v.data.admission,verifier:v.data.verifier,coverage:v.data.coverage,omissions:v.data.omissions,findings:v.data.findings,waivers:related.map(w=>({id:w.id,scope:w.data.scope,expires_at:w.data.expires_at??null,active:active.some(a=>a.id===w.id)})),waived:active.length>0};
    });
    const state=checks.some(c=>['FAIL','ERROR'].includes(c.effective_state))?'FAIL':checks.length&&checks.every(c=>c.effective_state==='PASS')?'PASS':'UNKNOWN';
    return{candidate_id:candidate.id,state,checks,canonical_passes:checks.filter(c=>c.effective_state==='PASS').length,failures:checks.filter(c=>['FAIL','ERROR'].includes(c.effective_state)).length,unknown:checks.filter(c=>c.effective_state==='UNKNOWN').length};
  }
  candidateGates(candidate){return buildCandidateGates(this,candidate);}
  inspectCandidate(candidate){return inspectCandidateState(this,candidate);}
  read(operation,input){
    switch(operation){
      case'candidate.inspect':inputObject(input,['id']);return this.inspectCandidate(this.get(input.id,'candidate'));
      case'verification.summary':inputObject(input,['candidate_id']);return this.verificationSummary(input.candidate_id);
      default:throw new NativeError('Unsupported','Read operation is outside review profile');
    }
  }
  mutate(operation,input){
    switch(operation){
      case'verification.record':{
        const data=validateVerification(input),candidate=this.get(data.candidate_id,'candidate');
        const artifactSet=new Set(candidate.data.manifest.artifact_ids);
        for(const id of data.artifact_ids)ensure(artifactSet.has(id),'Verification references bytes outside the candidate','PermissionDenied');
        if(data.target_id){const target=this.get(data.target_id,'target');ensure(target.data.release_id===candidate.data.release_id,'Verification target belongs to another release','PermissionDenied');}
        if(data.verifier.authority==='canonical')ensure(this.capabilities.canonical_verifier_admission===true,'Canonical verifier admission is unavailable in this session','PolicyDenied');
        const admission=data.verifier.authority==='canonical'?'canonical-owner-admitted':data.verifier.authority==='heuristic'?'heuristic-report':'local-review-record';
        return{entity:this.store.create('verification',{release_id:candidate.data.release_id,name:data.dimension+' verification',...data,admission,recorded_by:this.principal,recorded_at:iso()})};
      }
      case'waiver.record':{
        const data=validateWaiver(input),candidate=this.get(data.candidate_id,'candidate'),verification=this.get(data.verification_id,'verification');
        ensure(verification.data.candidate_id===candidate.id&&verification.data.release_id===candidate.data.release_id,'Waiver verification belongs to another candidate','PermissionDenied');
        ensure(verification.data.state!=='PASS','A passing verification does not need a waiver','InvalidArgument');
        if(data.expires_at)ensure(Date.parse(data.expires_at)>Date.now(),'Waiver is already expired','InvalidArgument');
        return{entity:this.store.create('waiver',{release_id:candidate.data.release_id,name:'Waiver · '+verification.data.dimension,...data,author:this.principal,underlying_state:verification.data.state,created_at:iso(),changes_verification_state:false})};
      }
      case'candidate.freeze':return freezeCandidate(this,input);
      case'candidate.review':return recordCandidateReview(this,input);
      case'candidate.deliver_private':{
        inputObject(input,['id','candidate_sha256','alias_expected','acknowledge_draft']);const candidate=this.get(input.id,'candidate');ensure(input.candidate_sha256===candidate.data.candidate_sha256,'Candidate digest differs','Conflict');ensure(input.acknowledge_draft===true,'Private delivery is a draft, not a verified launch','ConsentRequired');
        const checked=this.inspectCandidate(candidate);assertPrivateDeliveryReady(candidate,checked);
        const name=candidate.data.manifest.destination,row=this.store.db.prepare('SELECT * FROM aliases WHERE name=?').get(name);
        if(row)ensure(input.alias_expected&&sameVersion(input.alias_expected,{resource:`alias:${name}`,generation:row.generation,revision:row.revision}),'Private alias changed','StaleReference');
        else ensure(input.alias_expected===null,'Private alias did not exist','StaleReference');
        const generation=row?.generation??randomUUID(),revision=row?(BigInt(row.revision)+1n).toString():'1';
        this.store.db.prepare('INSERT INTO aliases VALUES(?,?,?,?) ON CONFLICT(name) DO UPDATE SET revision=excluded.revision,candidate_id=excluded.candidate_id').run(name,generation,revision,candidate.id);
        return{entity:this.store.create('delivery',{release_id:candidate.data.release_id,name,candidate_id:candidate.id,candidate_sha256:candidate.data.candidate_sha256,state:'PRIVATE_DRAFT_RECORDED',external_state:'NOT_SENT',alias_version:{resource:`alias:${name}`,generation,revision},artifact_ids:candidate.data.manifest.artifact_ids,technical_state:checked.technical_state,delivered_by:this.principal})};
      }

      case'channel.package':{
        const data=validateChannelPackage(input),candidate=this.get(data.candidate_id,'candidate'),profile=this.get(data.profile_id,'channel_profile'),release=this.get(candidate.data.release_id,'release');
        ensure(profile.data.product_id===release.data.product_id,'Channel profile belongs to another product','PermissionDenied');
        const checked=this.inspectCandidate(candidate);ensure(checked.private_draft_allowed,'Candidate has stale inputs or invalid bytes','StaleReference');
        if(candidate.data.manifest.schema_version==='launchwright-candidate/2'){assertChannelPinned(candidate,profile);assertPartialDeliveryPolicy(candidate,data.allow_partial);}
        if(!data.allow_partial)ensure(data.omissions.length===0,'Package omissions require explicit partial delivery approval','ConsentRequired');
        if(data.allow_partial)ensure(data.omissions.length>0,'Partial delivery must enumerate the omitted variants or obligations');
        const candidateManifestBytes=Buffer.from(JSON.stringify(candidate.data.manifest,null,2)+'\n'),candidateManifestSha=this.store.blob(candidateManifestBytes,'application/json');
        const manifest={schema_version:'launchwright-channel-package/2',candidate_id:candidate.id,candidate_sha256:candidate.data.candidate_sha256,candidate_manifest_sha256:candidateManifestSha,release_id:release.id,profile:{id:profile.id,version:profile.version,profile_version:profile.data.profile_version,channel:profile.data.channel,destination_class:profile.data.destination_class},participant:data.participant,locale:data.locale,partial:data.allow_partial,omissions:data.omissions,bundle_recipe:'private-zip-v1',artifacts:candidate.data.manifest.artifacts};
        const bytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n'),packageSha=this.store.blob(bytes,'application/json');
        return{entity:this.store.create('channel_delivery',{release_id:release.id,name:profile.data.channel+' · '+data.participant,profile_id:profile.id,profile_version:profile.version,candidate_id:candidate.id,candidate_sha256:candidate.data.candidate_sha256,candidate_manifest_sha256:candidateManifestSha,participant:data.participant,locale:data.locale,partial:data.allow_partial,omissions:data.omissions,package_sha256:packageSha,package_size_bytes:bytes.length,bundle_recipe:'private-zip-v1',state:'PACKAGE_READY',external_state:'NOT_SENT',root_delivery_id:null,parent_delivery_id:null,recovery_required:false,created_by:this.principal}),manifest};
      }
      case'channel.record_outcome':{
        const data=validateChannelOutcome(input),base=this.get(data.delivery_id,'channel_delivery'),profile=this.get(base.data.profile_id,'channel_profile');
        ensure(base.data.release_id&&base.data.candidate_id,'Channel delivery record is incomplete','Conflict');
        if(['UPLOADED','DRAFT_CREATED','ACTIVATED','PUBLISHED','RETIRED'].includes(data.state))ensure(!!data.receipt_digest,'External success state requires an exact receipt digest','InvalidArgument');
        if(['ACTIVATED','PUBLISHED','RETIRED'].includes(data.state))ensure(this.capabilities.canonical_publish_receipts===true,'Canonical publish receipt admission is unavailable in this session','PolicyDenied');
        const root=base.data.root_delivery_id??base.id,recoveryRequired=data.state==='UNKNOWN'&&profile.data.idempotency!=='safe';
        return{entity:this.store.create('channel_delivery',{release_id:base.data.release_id,name:base.data.name,profile_id:base.data.profile_id,profile_version:base.data.profile_version,candidate_id:base.data.candidate_id,candidate_sha256:base.data.candidate_sha256,candidate_manifest_sha256:base.data.candidate_manifest_sha256??null,participant:base.data.participant,locale:base.data.locale,partial:base.data.partial,omissions:base.data.omissions,package_sha256:base.data.package_sha256,package_size_bytes:base.data.package_size_bytes,bundle_recipe:base.data.bundle_recipe??null,state:data.state,external_state:data.state,external_id:data.external_id??null,receipt_digest:data.receipt_digest??null,message:data.message??'',observed_at:data.observed_at,root_delivery_id:root,parent_delivery_id:base.id,recovery_required:recoveryRequired,retry_policy:recoveryRequired?'RECOVER_BEFORE_RETRY':profile.data.idempotency==='safe'?'IDEMPOTENT_RETRY_ALLOWED':'NO_AUTOMATIC_RETRY',recorded_by:this.principal})};
      }
      default:throw new NativeError('Unsupported','Mutation is outside review profile');
    }
  }
}
