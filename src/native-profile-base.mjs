// SPDX-License-Identifier: AGPL-3.0-only
import { NativeError, object, requestIdentity, requireCondition as ensure, checkCancelled, text } from '@semwright/native-sdk';
import { Store } from './store.mjs';
import { RESOURCE, makeRequest } from './base.mjs';

export const nativeDriverName = operation => 'driver.launchwright.' + operation.replaceAll('.', '-');

export class NativeProfileApplication {
  constructor(root,{readOnly=false,principal='native-host-delegate',readOperations=[],operations=[],capabilities={}}={}) {
    this.store=new Store(root,{readOnly});
    this.principal=text(principal,128,'principal');
    this.readOperations=new Set(readOperations);
    this.capabilities=capabilities;
    this.operations=new Map(operations.map(operation=>[
      nativeDriverName(operation),
      (raw,context)=>this.dispatchNative(operation,raw,context)
    ]));
  }
  close(){this.store.close();}
  get(id,kind){
    text(id,96,'resource ID');
    ensure(/^[a-z][a-z0-9_-]{1,95}$/.test(id),'Invalid resource ID');
    const e=this.store.get(id);
    ensure(!kind||e.kind===kind,'Resource kind differs from the operation contract');
    return e;
  }
  list(kind,release){return this.store.all(kind).filter(e=>!release||e.data.release_id===release);}
  productOf(e){
    if(e.kind==='product')return e.id;
    if(e.data.product_id)return e.data.product_id;
    if(e.data.release_id)return this.get(e.data.release_id,'release').data.product_id;
    return null;
  }
  freshness(pins){
    const changed=[];
    for(const p of pins){
      let now;
      try{now=this.get(p.id);}catch{changed.push({id:p.id,reason:'missing'});continue;}
      if(now.version.generation!==p.version.generation||now.version.revision!==p.version.revision){
        changed.push({id:p.id,reason:'revision-changed',expected:p.version,observed:now.version});
      }
    }
    return changed;
  }
  dispatchNative(operation,raw,context){
    const read=this.readOperations.has(operation);
    object(raw,read?['ref','input']:['ref','request','input'],read?['ref','input']:['ref','request','input']);
    text(raw.ref,4096,'canonical reference');
    return this.invoke(operation,read?raw.input:{request:raw.request,input:raw.input},context);
  }
  invoke(operation,args,context){
    checkCancelled(context);
    if(this.readOperations.has(operation))return this.read(operation,args,context);
    object(args,['request','input'],['request','input']);
    const request=requestIdentity(args.request);
    ensure(request.resource===RESOURCE,'Request is bound to a different workspace');
    const prepared=makeRequest(operation,args.input,context.expected,request.epoch,request.key);
    ensure(prepared.request.request_sha256===request.request_sha256,'Request digest does not match command, input, revision and identity','Conflict');
    return this.store.transaction(operation,this.principal,request,context.expected,()=>{
      checkCancelled(context);
      return this.mutate(operation,args.input,context);
    });
  }
  read(){throw new NativeError('Unsupported','Read operation is outside this native profile');}
  mutate(){throw new NativeError('Unsupported','Mutation is outside this native profile');}
}
