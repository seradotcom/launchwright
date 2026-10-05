// SPDX-License-Identifier: AGPL-3.0-only
import { NativeError, object, integer, requestIdentity, sameVersion, checkCancelled, requireCondition as ensure, text } from '@semwright/native-sdk';
import { Store } from './store.mjs';
import { APP_VERSION, RESOURCE, makeRequest, iso, digest } from './base.mjs';
import { KINDS, EDITABLE, validateEntity, inputObject, idText, str, lines, choice } from './contracts.mjs';
import { proposeChange, inspectChange, applyChange } from './change-proposal.mjs';

export const CORE_NATIVE_OPERATIONS=Object.freeze([
  'workspace.describe','resource.get','events.list','change.inspect',
  'entity.create','entity.update','entity.retire','change.propose','change.apply','template.instantiate'
]);
const CORE_NATIVE_READS=new Set(['workspace.describe','resource.get','events.list','change.inspect']);
const driverName=operation=>'driver.launchwright.'+operation.replaceAll('.','-');

export class CoreNativeApplication {
  constructor(root,{readOnly=false,principal='native-host-delegate'}={}) {
    this.store=new Store(root,{readOnly});this.principal=str(principal,128);
    this.operations=new Map(CORE_NATIVE_OPERATIONS.map(operation=>[driverName(operation),(raw,context)=>{
      const read=CORE_NATIVE_READS.has(operation);
      object(raw,read?['ref','input']:['ref','request','input'],read?['ref','input']:['ref','request','input']);text(raw.ref,4096,'canonical reference');
      return this.invoke(operation,read?raw.input:{request:raw.request,input:raw.input},context);
    }]));
  }
  close(){this.store.close();}
  get(id,kind){idText(id);const e=this.store.get(id);ensure(!kind||e.kind===kind,'Resource kind differs from the operation contract');return e;}
  productOf(e){if(e.kind==='product')return e.id;if(e.data.product_id)return e.data.product_id;if(e.data.release_id)return this.get(e.data.release_id,'release').data.product_id;return null;}
  assertReferences(kind,d){
    if(d.product_id)this.get(d.product_id,'product');
    const release=d.release_id?this.get(d.release_id,'release'):null,product=d.product_id??release?.data.product_id;
    const ref=(id,type)=>{const e=this.get(id,type);ensure(!product||this.productOf(e)===product,'Cross-product reference is not permitted','PermissionDenied');if(release&&e.data.release_id)ensure(e.data.release_id===release.id,'Reference belongs to another release');return e;};
    for(const [field,type] of [['build_id','build'],['source_id','source'],['target_id','target'],['feature_id','feature'],['availability_id','availability'],['claim_id','claim'],['deliverable_id','deliverable']])if(d[field])ref(d[field],type);
    if(d.pinned_artifact_id){const a=ref(d.pinned_artifact_id,'artifact');ensure(a.data.deliverable_id===d.deliverable_id,'Pinned artifact belongs to another deliverable');}
    for(const [field,type] of [['claim_ids','claim'],['copy_block_ids','copy_block'],['source_ids','source'],['evidence_ids','evidence'],['required_claim_ids','claim'],['optional_claim_ids','claim'],['required_deliverable_ids','deliverable']])for(const id of d[field]??[])ref(id,type);
    if(kind==='claim'){for(const id of d.evidence_ids){const e=this.get(id,'evidence');ensure(e.data.target_id===d.target_id,'Evidence target does not match claim');}if(d.availability_id)ensure(this.get(d.availability_id,'availability').data.target_id===d.target_id,'Availability target does not match claim');}
    if(kind==='copy_block')ensure(this.get(d.claim_id,'claim').data.target_id===d.target_id,'CopyBlock target differs from its Claim target');
    if(kind==='deliverable'){for(const id of d.claim_ids)ensure(this.get(id,'claim').data.target_id===d.target_id,'Claim is for another target');for(const id of d.copy_block_ids??[])ensure(this.get(id,'copy_block').data.target_id===d.target_id,'CopyBlock is for another target');}
  }
  observe(query,context){
    checkCancelled(context);ensure(query.resource===RESOURCE,'Unknown observable resource','NotFound');ensure(query.scope==='all'||KINDS.includes(query.scope),'Unknown observation scope');
    const current=this.store.version();if(query.cursor)ensure(sameVersion(query.cursor.version,current),'Observation changed during pagination','StaleReference');
    let after='';if(query.cursor){try{const c=JSON.parse(Buffer.from(query.cursor.token,'base64url').toString());object(c,['after','limit'],['after','limit']);ensure(c.limit===query.limit,'Cursor page size changed','StaleReference');after=idText(c.after);}catch(e){if(e instanceof NativeError)throw e;throw new NativeError('StaleReference','Invalid cursor; resync from the first page');}}
    const rows=this.store.all(query.scope).filter(r=>r.id>after),items=[];let size=1024;
    for(const r of rows){const bytes=Buffer.byteLength(JSON.stringify(r));if(items.length===query.limit||size+bytes>190000)break;items.push(r);size+=bytes;}
    ensure(items.length>0||rows.length===0,'One record exceeds observation budget','ResourceExhausted');const complete=items.length===rows.length;
    return{version:current,scope:query.scope,items,complete,next:complete?null:{version:current,scope:query.scope,token:Buffer.from(JSON.stringify({after:items.at(-1).id,limit:query.limit})).toString('base64url')}};
  }
  lookup(identity,context){
    checkCancelled(context);ensure(identity.resource===RESOURCE,'Unknown recovery resource','NotFound');
    const row=this.store.db.prepare('SELECT * FROM receipts WHERE epoch=? AND key=?').get(identity.epoch,identity.key);
    if(row){ensure(row.digest===identity.request_sha256&&row.principal===this.principal,'Recovery identity differs from its durable binding','Conflict');return{state:'recorded',identity,result:JSON.parse(row.result)};}
    const epoch=this.store.meta().epoch;return identity.epoch<epoch?{state:'retention_expired',identity,current_epoch:epoch}:{state:'outcome_unknown',identity};
  }
  describe(){return{app:'Launchwright',version:APP_VERSION,schema_version:'launchwright/1',native_profile:'core',workspace_version:this.store.version(),request_epoch:this.store.meta().epoch,principal:this.principal,operations:CORE_NATIVE_OPERATIONS,native_sdk:'0.9.0-dev.1',authority:'application-domain-only'};}
  read(op,input){
    if(op==='workspace.describe'){inputObject(input,[]);return this.describe();}
    if(op==='resource.get'){inputObject(input,['id']);return this.get(input.id);}
    if(op==='events.list'){inputObject(input,['after','limit'],[]);const after=integer(input.after??0,0,Number.MAX_SAFE_INTEGER),limit=integer(input.limit??50,1,128);const rows=this.store.db.prepare('SELECT * FROM events WHERE seq>? ORDER BY seq LIMIT ?').all(after,limit+1),more=rows.length>limit,items=rows.slice(0,limit).map(e=>({...e,payload:JSON.parse(e.payload),schema_version:'launchwright-event/1'}));return{items,next_after:more?items.at(-1).seq:null,watermark:this.store.db.prepare('SELECT coalesce(max(seq),0) AS n FROM events').get().n,complete:!more};}
    if(op==='change.inspect'){inputObject(input,['id']);return inspectChange(this,input.id);}
    throw new NativeError('Unsupported','Operation is outside this native profile');
  }
  mutate(op,input){
    if(op==='entity.create'){inputObject(input,['kind','data']);choice(input.kind,EDITABLE);const data=validateEntity(input.kind,input.data);this.assertReferences(input.kind,data);return{entity:this.store.create(input.kind,data)};}
    if(op==='entity.update'){inputObject(input,['id','expected','data']);const e=this.get(input.id);ensure(EDITABLE.includes(e.kind),'Immutable resource cannot be edited','PermissionDenied');ensure(sameVersion(e.version,input.expected),'Entity revision changed','StaleReference');const data=validateEntity(e.kind,input.data);for(const parent of ['product_id','release_id'])ensure(e.data[parent]===data[parent],'Resource parent is immutable');this.assertReferences(e.kind,data);return{entity:this.store.update(e.id,e.data.template_origin?{...data,template_origin:e.data.template_origin}:data)};}
    if(op==='change.propose')return proposeChange(this,input);
    if(op==='change.apply')return applyChange(this,input);
    if(op==='entity.retire'){inputObject(input,['id','expected','reason']);const e=this.get(input.id);ensure(EDITABLE.includes(e.kind),'Only editable domain resources can be retired','PermissionDenied');ensure(sameVersion(e.version,input.expected),'Entity revision changed','StaleReference');lines(input.reason,4000);if(['product','release'].includes(e.kind)){const children=this.store.all().filter(x=>x.kind!=='tombstone'&&(x.data.product_id===e.id||x.data.release_id===e.id));ensure(children.length===0,'Retire active children before their parent','Conflict');}return{entity:this.store.retire(e.id,{subject_id:e.id,original_kind:e.kind,retired_at:iso(),reason:input.reason,content_revoked:true})};}
    if(op==='template.instantiate'){inputObject(input,['id','release_id','target_id','parameters','name']);const template=this.get(input.id,'template');object(input.parameters,template.data.parameters,template.data.parameters);for(const value of Object.values(input.parameters))str(value,4000);const data={release_id:input.release_id,target_id:input.target_id,name:str(input.name,160),format:template.data.format,content:template.data.content.replace(/\{\{([a-z][a-z0-9_]*)\}\}/g,(_,key)=>{ensure(Object.hasOwn(input.parameters,key),'Template contains an undeclared parameter');return input.parameters[key];}),claim_ids:[],source_ids:[]};validateEntity('deliverable',data);this.assertReferences('deliverable',data);return{entity:this.store.create('deliverable',{...data,template_origin:{id:template.id,version:template.version,parameters_sha256:digest('template-parameters',input.parameters)}}),template_pin:template.version};}
    throw new NativeError('Unsupported','Operation is outside this native profile');
  }
  invoke(op,args,context){
    checkCancelled(context);
    if(CORE_NATIVE_READS.has(op))return this.read(op,args);
    object(args,['request','input'],['request','input']);const request=requestIdentity(args.request);ensure(request.resource===RESOURCE,'Request is bound to a different workspace');
    const prepared=makeRequest(op,args.input,context.expected,request.epoch,request.key);ensure(prepared.request.request_sha256===request.request_sha256,'Request digest does not match command, input, revision and identity','Conflict');
    return this.store.transaction(op,this.principal,request,context.expected,()=>{checkCancelled(context);return this.mutate(op,args.input);});
  }
}
