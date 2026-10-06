// SPDX-License-Identifier: AGPL-3.0-only
import { NativeError, requireCondition as ensure, sameVersion } from '@semwright/native-sdk';
import { NativeProfileApplication } from './native-profile-base.mjs';
import { inputObject } from './contracts.mjs';
import { iso } from './base.mjs';
import { validateLocalization, assessLocalization } from './localization.mjs';
import { inspectMobileImport, registerMobileImport } from './mobile-import.mjs';

export const INTEGRATIONS_NATIVE_READS=Object.freeze(['localization.assess','mobile.inspect','channel.status']);
export const INTEGRATIONS_NATIVE_MUTATIONS=Object.freeze(['localization.create','localization.update','mobile.import']);
export const INTEGRATIONS_NATIVE_OPERATIONS=Object.freeze([...INTEGRATIONS_NATIVE_READS,...INTEGRATIONS_NATIVE_MUTATIONS]);

export class IntegrationsNativeApplication extends NativeProfileApplication {
  constructor(root,options={}){super(root,{...options,readOperations:INTEGRATIONS_NATIVE_READS,operations:INTEGRATIONS_NATIVE_OPERATIONS});}
  channelStatus(releaseId){
    this.get(releaseId,'release');
    const rows=this.list('channel_delivery',releaseId).sort((a,b)=>a.created.localeCompare(b.created)),latest=new Map();
    for(const row of rows)latest.set(row.data.profile_id+'\0'+row.data.participant,row);
    return{release_id:releaseId,deliveries:rows,latest:[...latest.values()],profiles:this.list('channel_profile').filter(p=>rows.some(r=>r.data.profile_id===p.id)).map(p=>({id:p.id,name:p.data.name,channel:p.data.channel,profile_version:p.data.profile_version,destination_class:p.data.destination_class,idempotency:p.data.idempotency})),external_send_performed:false};
  }
  read(operation,input){
    switch(operation){
      case'localization.assess':inputObject(input,['id']);return assessLocalization(this,this.get(input.id,'localized_copy'));
      case'mobile.inspect':return inspectMobileImport(this,input);
      case'channel.status':inputObject(input,['release_id']);return this.channelStatus(input.release_id);
      default:throw new NativeError('Unsupported','Read operation is outside integrations profile');
    }
  }
  mutate(operation,input){
    switch(operation){
      case'localization.create':{
        const data=validateLocalization(input),release=this.get(data.release_id,'release'),target=this.get(data.target_id,'target'),source=this.get(data.source_copy_block_id,'copy_block');
        ensure(target.data.release_id===release.id&&source.data.release_id===release.id,'Localization scope mismatch','PermissionDenied');
        let glossary=null;
        if(data.glossary_id){glossary=this.get(data.glossary_id,'glossary');ensure(glossary.data.product_id===release.data.product_id,'Glossary product mismatch','PermissionDenied');ensure(glossary.data.status==='active','Glossary is deprecated','Conflict');ensure(glossary.data.source_locale===source.data.locale&&glossary.data.target_locale===data.locale,'Glossary locale mismatch','Conflict');}
        return{entity:this.store.create('localized_copy',{...data,source_version:source.version,glossary_version:glossary?.version??null,created_by:this.principal,created_at:iso()})};
      }
      case'localization.update':{
        inputObject(input,['id','expected','data','acknowledge_rebase'],['id','expected','data']);const prior=this.get(input.id,'localized_copy');ensure(sameVersion(prior.version,input.expected),'Localization revision changed','StaleReference');const data=validateLocalization(input.data);
        for(const key of ['release_id','target_id','source_copy_block_id','glossary_id'])ensure((data[key]??null)===(prior.data[key]??null),'Localization identity is immutable','Conflict');
        const source=this.get(data.source_copy_block_id,'copy_block'),glossary=data.glossary_id?this.get(data.glossary_id,'glossary'):null;
        const sourceDrift=!sameVersion(source.version,prior.data.source_version),glossaryDrift=!!glossary&&!sameVersion(glossary.version,prior.data.glossary_version);
        if(sourceDrift||glossaryDrift)ensure(input.acknowledge_rebase===true,'Source/glossary changed; explicit rebase required','StaleReference');
        if(glossary){ensure(glossary.data.status==='active','Glossary is deprecated','Conflict');ensure(glossary.data.source_locale===source.data.locale&&glossary.data.target_locale===data.locale,'Glossary locale mismatch','Conflict');}
        return{entity:this.store.update(prior.id,{...data,source_version:source.version,glossary_version:glossary?.version??null,created_by:prior.data.created_by,created_at:prior.data.created_at,updated_by:this.principal,updated_at:iso()})};
      }
      case'mobile.import':return registerMobileImport(this,input);
      default:throw new NativeError('Unsupported','Mutation is outside integrations profile');
    }
  }
}
