// SPDX-License-Identifier: AGPL-3.0-only
import { NativeError, requireCondition as ensure, sameVersion, integer } from '@semwright/native-sdk';
import { NativeProfileApplication } from './native-profile-base.mjs';
import { KINDS, inputObject, str, choice, array, lines } from './contracts.mjs';
import { OPERATION_SCOPES } from './operations.mjs';
import { iso } from './base.mjs';
import { validateLocalization, assessLocalization } from './localization.mjs';
import { validateExtensionManifest, validateCompatibilityLock } from './extensions.mjs';
import { inspectMobileImport, registerMobileImport } from './mobile-import.mjs';

export const INTEGRATIONS_NATIVE_READS=Object.freeze([
  'localization.assess','extension.discovery','compatibility.negotiate','compatibility.inspect','mobile.inspect','channel.status'
]);
export const INTEGRATIONS_NATIVE_MUTATIONS=Object.freeze([
  'localization.create','localization.update','extension.register','extension.retire','compatibility.lock','mobile.import'
]);
export const INTEGRATIONS_NATIVE_OPERATIONS=Object.freeze([...INTEGRATIONS_NATIVE_READS,...INTEGRATIONS_NATIVE_MUTATIONS]);

export class IntegrationsNativeApplication extends NativeProfileApplication {
  constructor(root,options={}){super(root,{...options,readOperations:INTEGRATIONS_NATIVE_READS,operations:INTEGRATIONS_NATIVE_OPERATIONS});}
  extensionDiscovery(input){
    inputObject(input,['type','include_retired'],[]);
    if(input.type!==undefined)choice(input.type,['source_adapter','deliverable_renderer','channel_adapter','verifier_profile']);
    if(input.include_retired!==undefined)ensure(typeof input.include_retired==='boolean','include_retired must be boolean');
    const items=this.list('extension_package').filter(e=>(!input.type||e.data.type===input.type)&&(input.include_retired||e.data.status==='active')).map(e=>({id:e.id,version:e.version,name:e.data.name,type:e.data.type,package_version:e.data.package_version,schema_major:e.data.schema_major,digest:e.data.digest,license:e.data.license,permissions:e.data.permissions,inputs:e.data.inputs,outputs:e.data.outputs,preconditions:e.data.preconditions,evidence:e.data.evidence,limits:e.data.limits,status:e.data.status,admission:e.data.admission}));
    return{schema_version:'launchwright-extension-discovery/1',items,remote_code_execution:false,platform_registry_authority:false};
  }
  compatibilityNegotiate(input){
    inputObject(input,['schema_major','operations','kinds'],['schema_major']);integer(input.schema_major,1,32);
    const operations=input.operations??[],kinds=input.kinds??[];array(operations,128).forEach(v=>str(v,160));array(kinds,128).forEach(v=>str(v,160));
    const supportedOps=new Set(Object.keys(OPERATION_SCOPES)),supportedKinds=new Set(KINDS);
    return{schema_major:1,requested_schema_major:input.schema_major,compatible:input.schema_major===1,unsupported_operations:operations.filter(v=>!supportedOps.has(v)),unsupported_kinds:kinds.filter(v=>!supportedKinds.has(v)),supported_optional:{extensions:true,localization:true,channel_packages:true,portable_snapshots:true},major_mismatch_behavior:'reject'};
  }
  compatibilityInspect(id){
    const lock=this.get(id,'compatibility_lock');
    const components=lock.data.components.map(c=>{
      if(!c.resource_id)return{...c,state:'DECLARED',observed:null};
      let r;try{r=this.get(c.resource_id);}catch{return{...c,state:'MISSING',observed:null};}
      if(r.kind==='tombstone')return{...c,state:'RETIRED',observed:{kind:r.kind,version:r.version}};
      let observedVersion=r.version.revision,observedDigest=null;
      if(r.kind==='extension_package'){observedVersion=r.data.package_version;observedDigest=r.data.digest;if(r.data.status==='retired')return{...c,state:'RETIRED',observed:{kind:r.kind,version:observedVersion,digest:observedDigest,resource_version:r.version}};}
      if(r.kind==='channel_profile')observedVersion=r.data.profile_version;
      const versionMatch=observedVersion===c.version,digestMatch=!c.digest||observedDigest===c.digest;
      return{...c,state:versionMatch&&digestMatch?'CURRENT':'DRIFT',observed:{kind:r.kind,version:observedVersion,digest:observedDigest,resource_version:r.version}};
    });
    return{lock,components,state:components.some(c=>['MISSING','RETIRED','DRIFT'].includes(c.state))?'DRIFT':'CURRENT',authority:'application-compatibility-lock-only',rehearsal_required_on_change:true};
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
      case'extension.discovery':return this.extensionDiscovery(input);
      case'compatibility.negotiate':return this.compatibilityNegotiate(input);
      case'compatibility.inspect':inputObject(input,['id']);return this.compatibilityInspect(input.id);
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
      case'extension.register':{
        const data=validateExtensionManifest(input);ensure(data.schema_major===1,'Unsupported extension schema major','ProtocolMismatch');
        const duplicate=this.list('extension_package').find(e=>e.data.type===data.type&&e.data.name===data.name&&e.data.package_version===data.package_version&&e.data.status==='active');
        ensure(!duplicate,'Extension version already registered','Conflict');
        return{entity:this.store.create('extension_package',{...data,status:'active',admission:'local-descriptor-only',remote_code_executable:false,registered_by:this.principal,registered_at:iso()})};
      }
      case'extension.retire':{
        inputObject(input,['id','expected','reason']);const ext=this.get(input.id,'extension_package');ensure(sameVersion(ext.version,input.expected),'Extension changed','StaleReference');ensure(ext.data.status==='active','Extension already retired','Conflict');lines(input.reason,4000);
        return{entity:this.store.update(ext.id,{...ext.data,status:'retired',retired_by:this.principal,retired_at:iso(),retire_reason:input.reason,new_use_allowed:false})};
      }
      case'mobile.import':return registerMobileImport(this,input);
      case'compatibility.lock':{
        const data=validateCompatibilityLock(input),product=this.get(data.product_id,'product');
        const components=data.components.map(c=>{
          if(!c.resource_id)return{...c,resource_version:null};
          const r=this.get(c.resource_id);
          if(r.kind!=='extension_package')ensure(this.productOf(r)===product.id,'Compatibility product mismatch','PermissionDenied');
          if(r.kind==='extension_package')ensure(r.data.status==='active','Retired extension cannot be locked','Conflict');
          if(c.kind==='channel-profile')ensure(r.kind==='channel_profile','Compatibility kind mismatch');
          if(c.kind==='template')ensure(r.kind==='template','Compatibility kind mismatch');
          if(['source-adapter','renderer','channel-adapter','verifier'].includes(c.kind))ensure(r.kind==='extension_package','Extension descriptor required');
          return{...c,resource_version:r.version};
        });
        return{entity:this.store.create('compatibility_lock',{...data,components,product_version:product.version,created_by:this.principal,created_at:iso(),authority:'application-rehearsal-lock'})};
      }

      default:throw new NativeError('Unsupported','Mutation is outside integrations profile');
    }
  }
}
