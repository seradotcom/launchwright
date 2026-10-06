// SPDX-License-Identifier: AGPL-3.0-only
import { NativeError, requireCondition as ensure, sameVersion, integer } from '@semwright/native-sdk';
import { NativeProfileApplication } from './native-profile-base.mjs';
import { KINDS, OPERATION_SCOPES, inputObject, str, choice, array, lines } from './contracts.mjs';
import { iso } from './base.mjs';
import {
  validateExtensionManifest, validateCompatibilityLock, prepareExtensionUse,
  inspectExtensionPreparation, genericExtensionView, recordExtensionResult, inspectExtensionResult
} from './extensions.mjs';
import { recordCliObservation, inspectCliObservation } from './cli-source.mjs';

export const EXTENSIONS_NATIVE_READS=Object.freeze([
  'extension.discovery','extension.generic_view','extension.preparation_status','extension.result_inspect',
  'source.cli_inspect','compatibility.negotiate','compatibility.inspect'
]);
export const EXTENSIONS_NATIVE_MUTATIONS=Object.freeze([
  'extension.register','extension.retire','extension.prepare_use','extension.result_record',
  'source.cli_ingest','compatibility.lock'
]);
export const EXTENSIONS_NATIVE_OPERATIONS=Object.freeze([...EXTENSIONS_NATIVE_READS,...EXTENSIONS_NATIVE_MUTATIONS]);

export class ExtensionsNativeApplication extends NativeProfileApplication {
  constructor(root,options={}){super(root,{...options,readOperations:EXTENSIONS_NATIVE_READS,operations:EXTENSIONS_NATIVE_OPERATIONS});}
  extensionDiscovery(input){
    inputObject(input,['type','include_retired'],[]);
    if(input.type!==undefined)choice(input.type,['source_adapter','deliverable_renderer','channel_adapter','verifier_profile']);
    if(input.include_retired!==undefined)ensure(typeof input.include_retired==='boolean','include_retired must be boolean');
    const items=this.list('extension_package')
      .filter(e=>(!input.type||e.data.type===input.type)&&(input.include_retired||e.data.status==='active'))
      .map(e=>({id:e.id,version:e.version,name:e.data.name,type:e.data.type,package_version:e.data.package_version,schema_major:e.data.schema_major,digest:e.data.digest,license:e.data.license,rights:e.data.rights,permissions:e.data.permissions,inputs:e.data.inputs,outputs:e.data.outputs,preconditions:e.data.preconditions,evidence:e.data.evidence,limits:e.data.limits,status:e.data.status,admission:e.data.admission}));
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
  read(operation,input){
    switch(operation){
      case'extension.discovery':return this.extensionDiscovery(input);
      case'extension.generic_view':{inputObject(input,['id']);return genericExtensionView(this.get(input.id,'extension_package'));}
      case'extension.preparation_status':{inputObject(input,['id']);return inspectExtensionPreparation(this,input.id);}
      case'extension.result_inspect':{inputObject(input,['id']);return inspectExtensionResult(this,input.id);}
      case'source.cli_inspect':{inputObject(input,['id']);return inspectCliObservation(this,input.id);}
      case'compatibility.negotiate':return this.compatibilityNegotiate(input);
      case'compatibility.inspect':inputObject(input,['id']);return this.compatibilityInspect(input.id);
      default:throw new NativeError('Unsupported','Read operation is outside extensions profile');
    }
  }
  mutate(operation,input){
    switch(operation){
      case'extension.prepare_use':return{entity:prepareExtensionUse(this,input)};
      case'extension.result_record':return{entity:recordExtensionResult(this,input)};
      case'source.cli_ingest':return{entity:recordCliObservation(this,input)};
      case'extension.register':{
        const data=validateExtensionManifest(input);ensure(data.schema_major===1,'Unsupported extension schema major','ProtocolMismatch');
        const duplicate=this.list('extension_package').find(e=>e.data.type===data.type&&e.data.name===data.name&&e.data.package_version===data.package_version&&e.data.status==='active');
        ensure(!duplicate,'This extension version is already registered','Conflict');
        return{entity:this.store.create('extension_package',{...data,status:'active',admission:'local-descriptor-only',remote_code_executable:false,registered_by:this.principal,registered_at:iso()})};
      }
      case'extension.retire':{
        inputObject(input,['id','expected','reason']);const ext=this.get(input.id,'extension_package');ensure(sameVersion(ext.version,input.expected),'Extension revision changed','StaleReference');ensure(ext.data.status==='active','Extension is already retired','Conflict');lines(input.reason,4000);
        const affected=this.list('extension_preparation').filter(p=>p.data.extension_id===ext.id).map(p=>p.id);
        return{entity:this.store.update(ext.id,{...ext.data,status:'retired',retired_by:this.principal,retired_at:iso(),retire_reason:input.reason,new_use_allowed:false}),affected_preparations:affected};
      }
      case'compatibility.lock':{
        const data=validateCompatibilityLock(input),product=this.get(data.product_id,'product');
        const components=data.components.map(c=>{
          if(!c.resource_id)return{...c,resource_version:null};
          const r=this.get(c.resource_id);
          if(r.kind!=='extension_package')ensure(this.productOf(r)===product.id,'Compatibility component belongs to another product','PermissionDenied');
          if(r.kind==='extension_package')ensure(r.data.status==='active','Cannot lock a retired extension','Conflict');
          if(c.kind==='channel-profile')ensure(r.kind==='channel_profile','Compatibility component kind does not match resource');
          if(c.kind==='template')ensure(r.kind==='template','Compatibility component kind does not match resource');
          if(['source-adapter','renderer','channel-adapter','verifier'].includes(c.kind))ensure(r.kind==='extension_package','Compatibility component must reference an extension descriptor');
          return{...c,resource_version:r.version};
        });
        return{entity:this.store.create('compatibility_lock',{...data,components,product_version:product.version,created_by:this.principal,created_at:iso(),authority:'application-rehearsal-lock'})};
      }
      default:throw new NativeError('Unsupported','Mutation is outside extensions profile');
    }
  }
}
