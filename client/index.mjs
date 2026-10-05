// SPDX-License-Identifier: AGPL-3.0-only
// Public HTTP consumer. Does not import the application or its database.
export class LaunchwrightError extends Error {
  constructor(record,status=0){super(record.message);this.name='LaunchwrightError';this.code=record.code;this.outcomeKnown=record.outcome_known;this.status=status;}
}
export class LaunchwrightClient {
  constructor({baseUrl='http://127.0.0.1:4317',token=null,fetchImpl=globalThis.fetch,timeoutMs=15000,pendingStore=null}={}){
    this.baseUrl=baseUrl.replace(/\/$/,'');this.token=token;this.fetch=fetchImpl;this.timeoutMs=timeoutMs;this.pendingStore=pendingStore;
  }
  async request(path,body,method='POST'){
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),this.timeoutMs);
    try {
      const res=await this.fetch(this.baseUrl+path,{method,credentials:'same-origin',redirect:'error',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(this.token?{'Authorization':`Bearer ${this.token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:controller.signal});
      const data=await res.json();if(!res.ok)throw new LaunchwrightError(data.error??{code:'ProtocolMismatch',message:'Unexpected application reply',outcome_known:method==='GET'},res.status);return data;
    }catch(err){if(err instanceof LaunchwrightError)throw err;throw new LaunchwrightError({code:controller.signal.aborted?'Timeout':'Unavailable',message:method==='GET'?'Read could not complete':'Reply unavailable. Recover the original request; do not send a replacement.',outcome_known:method==='GET'});}
    finally{clearTimeout(timer);}
  }
  describe(){return this.request('/api/v1/describe',undefined,'GET');}
  get(id){return this.request('/api/v1/read',{operation:'resource.get',input:{id}});}
  read(operation,input={}){return this.request('/api/v1/read',{operation,input});}
  observe(scope='all',cursor=null,limit=64){return this.request('/api/v1/observe',{resource:'launchwright:workspace',scope,cursor,limit});}
  async *pages(scope='all',{limit=64,maxPages=100}={}){let cursor=null;for(let n=0;n<maxPages;n++){const p=await this.observe(scope,cursor,limit);yield p;if(p.complete)return;if(!p.next)throw new LaunchwrightError({code:'ProtocolMismatch',message:'Incomplete observation has no cursor',outcome_known:true});cursor=p.next;}throw new LaunchwrightError({code:'ResourceExhausted',message:'Observation page budget reached; resume explicitly',outcome_known:true});}
  async inventory(){const entities=[];let version=null;for await(const page of this.pages()){version=page.version;entities.push(...page.items);}return{entities,version};}
  async prepare(operation,input,{expected,key=globalThis.crypto.randomUUID()}={}){
    return this.request('/api/v1/prepare',{operation,input,key,...(expected?{expected}:{})});
  }
  async sendPrepared(prepared){
    // Durable custody should precede any network send. Browser UI supplies localStorage; CLI writes a file.
    if(this.pendingStore)await this.pendingStore.save(prepared);
    return this.request('/api/v1/invoke',prepared);
  }
  async mutate(operation,input,options){const prepared=await this.prepare(operation,input,options);try{const result=await this.sendPrepared(prepared);if(this.pendingStore)await this.pendingStore.clear(prepared.args.request.key);return result;}catch(err){err.prepared=prepared;throw err;}}
  async recover(prepared){return this.request('/api/v1/recover',prepared.args.request);}
  artifactUrl(id){return this.baseUrl+'/api/v1/artifacts/'+encodeURIComponent(id)+'/download';}
}
