// SPDX-License-Identifier: AGPL-3.0-only
import { NativeError, requireCondition as ensure, sameVersion } from '@semwright/native-sdk';
import { NativeProfileApplication } from './native-profile-base.mjs';
import { inputObject, str } from './contracts.mjs';
import { iso } from './base.mjs';
import { validateLocalization, assessLocalization } from './localization.mjs';
import { validateChannelOutcome } from './records.mjs';
import { PROFILE_MATRIX } from './extensions.mjs';

export const INTEGRATIONS_NATIVE_READS=Object.freeze([
  'localization.assess','profile.matrix','profile.preflight','channel.status'
]);
export const INTEGRATIONS_NATIVE_MUTATIONS=Object.freeze(['localization.create','localization.update','channel.record_outcome']);
export const INTEGRATIONS_NATIVE_OPERATIONS=Object.freeze([...INTEGRATIONS_NATIVE_READS,...INTEGRATIONS_NATIVE_MUTATIONS]);

export class IntegrationsNativeApplication extends NativeProfileApplication {
  constructor(root,options={}){super(root,{...options,readOperations:INTEGRATIONS_NATIVE_READS,operations:INTEGRATIONS_NATIVE_OPERATIONS});}
  profilePreflight(input){
    inputObject(input,['profile','source_id','target_id'],['profile','source_id']);str(input.profile,64);
    const profile=PROFILE_MATRIX[input.profile];ensure(profile,'Unknown source profile','NotFound');
    const source=this.get(input.source_id,'source');let target=null,release=null;
    if(input.target_id){target=this.get(input.target_id,'target');release=this.get(target.data.release_id,'release');ensure(release.data.product_id===source.data.product_id,'Source and target belong to different products','PermissionDenied');}
    const checks=[
      {name:'source-type',state:profile.source_types.includes(source.data.type)?'PASS':'FAIL',detail:source.data.type},
      {name:'source-purpose',state:source.data.approval==='approved'?'PASS':input.profile==='mobile-import'||input.profile==='document'?'UNKNOWN':'FAIL',detail:source.data.approval??'undeclared'},
      {name:'build-match',state:release?source.data.build===release.data.build?'PASS':'FAIL':'UNKNOWN',detail:release?{source:source.data.build,release:release.data.build}:'target-not-supplied'},
      {name:'execution-authority',state:this.capabilities.profile_execution?.[input.profile]==='available'?'PASS':'UNKNOWN',detail:profile.execution}
    ];
    return{profile:input.profile,contract:profile,source_id:source.id,target_id:target?.id??null,checks,ready_for_native_execution:checks.every(c=>c.state==='PASS')&&profile.execution!=='import-only',import_only:profile.execution==='import-only',note:'Preflight validates Launchwright contracts only; tool presence, permissions and Host isolation require the owning runtime.'};
  }
  channelStatus(releaseId){
    this.get(releaseId,'release');
    const rows=this.list('channel_delivery',releaseId).sort((a,b)=>a.created.localeCompare(b.created)),latest=new Map();
    for(const row of rows)latest.set(row.data.profile_id+'\0'+row.data.participant,row);
    return{release_id:releaseId,deliveries:rows,latest:[...latest.values()],profiles:this.list('channel_profile').filter(p=>rows.some(r=>r.data.profile_id===p.id)).map(p=>({id:p.id,name:p.data.name,channel:p.data.channel,profile_version:p.data.profile_version,destination_class:p.data.destination_class,idempotency:p.data.idempotency})),external_send_performed:false};
  }
  read(operation,input){
    switch(operation){
      case'localization.assess':inputObject(input,['id']);return assessLocalization(this,this.get(input.id,'localized_copy'));
      case'profile.matrix':inputObject(input,[]);return{profiles:PROFILE_MATRIX,execution_proof:false};
      case'profile.preflight':return this.profilePreflight(input);
      case'channel.status':inputObject(input,['release_id']);return this.channelStatus(input.release_id);
      default:throw new NativeError('Unsupported','Read operation is outside integrations profile');
    }
  }
  mutate(operation,input){
    switch(operation){
      case'localization.create':{
        const data=validateLocalization(input),release=this.get(data.release_id,'release'),target=this.get(data.target_id,'target'),source=this.get(data.source_copy_block_id,'copy_block');
        ensure(target.data.release_id===release.id&&source.data.release_id===release.id,'Localization references another release','PermissionDenied');
        let glossary=null;
        if(data.glossary_id){glossary=this.get(data.glossary_id,'glossary');ensure(glossary.data.product_id===release.data.product_id,'Glossary belongs to another product','PermissionDenied');ensure(glossary.data.status==='active','Glossary is deprecated','Conflict');ensure(glossary.data.source_locale===source.data.locale&&glossary.data.target_locale===data.locale,'Glossary locale pair does not match localization','Conflict');}
        return{entity:this.store.create('localized_copy',{...data,source_version:source.version,glossary_version:glossary?.version??null,created_by:this.principal,created_at:iso()})};
      }
      case'localization.update':{
        inputObject(input,['id','expected','data','acknowledge_rebase'],['id','expected','data']);const prior=this.get(input.id,'localized_copy');ensure(sameVersion(prior.version,input.expected),'Localization revision changed','StaleReference');const data=validateLocalization(input.data);
        for(const key of ['release_id','target_id','source_copy_block_id','glossary_id'])ensure((data[key]??null)===(prior.data[key]??null),'Localization identity references are immutable; create another localization','Conflict');
        const source=this.get(data.source_copy_block_id,'copy_block'),glossary=data.glossary_id?this.get(data.glossary_id,'glossary'):null;
        const sourceDrift=!sameVersion(source.version,prior.data.source_version),glossaryDrift=!!glossary&&!sameVersion(glossary.version,prior.data.glossary_version);
        if(sourceDrift||glossaryDrift)ensure(input.acknowledge_rebase===true,'Source or glossary changed; review content and explicitly rebase','StaleReference');
        if(glossary){ensure(glossary.data.status==='active','Glossary is deprecated','Conflict');ensure(glossary.data.source_locale===source.data.locale&&glossary.data.target_locale===data.locale,'Glossary locale pair does not match localization','Conflict');}
        return{entity:this.store.update(prior.id,{...data,source_version:source.version,glossary_version:glossary?.version??null,created_by:prior.data.created_by,created_at:prior.data.created_at,updated_by:this.principal,updated_at:iso()})};
      }
      case'channel.record_outcome':{
        const data=validateChannelOutcome(input),base=this.get(data.delivery_id,'channel_delivery'),profile=this.get(base.data.profile_id,'channel_profile');
        ensure(base.data.release_id&&base.data.candidate_id,'Channel delivery incomplete','Conflict');
        if(['UPLOADED','DRAFT_CREATED','ACTIVATED','PUBLISHED','RETIRED'].includes(data.state))ensure(!!data.receipt_digest,'External success requires receipt digest','InvalidArgument');
        if(['ACTIVATED','PUBLISHED','RETIRED'].includes(data.state))ensure(this.capabilities.canonical_publish_receipts===true,'Canonical publish receipt unavailable','PolicyDenied');
        const root=base.data.root_delivery_id??base.id,recoveryRequired=data.state==='UNKNOWN'&&profile.data.idempotency!=='safe';
        return{entity:this.store.create('channel_delivery',{release_id:base.data.release_id,name:base.data.name,profile_id:base.data.profile_id,profile_version:base.data.profile_version,candidate_id:base.data.candidate_id,candidate_sha256:base.data.candidate_sha256,candidate_manifest_sha256:base.data.candidate_manifest_sha256??null,participant:base.data.participant,locale:base.data.locale,partial:base.data.partial,omissions:base.data.omissions,package_sha256:base.data.package_sha256,package_size_bytes:base.data.package_size_bytes,bundle_recipe:base.data.bundle_recipe??null,state:data.state,external_state:data.state,external_id:data.external_id??null,receipt_digest:data.receipt_digest??null,message:data.message??'',observed_at:data.observed_at,root_delivery_id:root,parent_delivery_id:base.id,recovery_required:recoveryRequired,retry_policy:recoveryRequired?'RECOVER_BEFORE_RETRY':profile.data.idempotency==='safe'?'IDEMPOTENT_RETRY_ALLOWED':'NO_AUTOMATIC_RETRY',recorded_by:this.principal})};
      }
      default:throw new NativeError('Unsupported','Mutation is outside integrations profile');
    }
  }
}
