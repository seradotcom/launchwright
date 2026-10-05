// SPDX-License-Identifier: AGPL-3.0-only
// Public HTTP consumer. It intentionally has no application/database imports.
export const CLIENT_VERSION='0.2.0-dev.14';
export const SUPPORTED_DISCOVERY_SCHEMAS=Object.freeze(['launchwright-http-discovery/1']);
export const SUPPORTED_APP_APIS=Object.freeze(['0.2']);

export class LaunchwrightError extends Error {
  constructor(record,status=0){super(record.message);this.name='LaunchwrightError';this.code=record.code;this.outcomeKnown=record.outcome_known;this.status=status;}
}
const unsupported=message=>new LaunchwrightError({code:'Unsupported',message,outcome_known:true});
export function validateDiscovery(record,{requiredOperations=[],supportedDiscoverySchemas=SUPPORTED_DISCOVERY_SCHEMAS,supportedAppApis=SUPPORTED_APP_APIS}={}){
  if(!record||typeof record!=='object'||Array.isArray(record))throw unsupported('Discovery reply is not an object');
  if(!supportedDiscoverySchemas.includes(record.schema_version))throw unsupported('Unsupported Launchwright discovery schema: '+String(record.schema_version));
  if(record.app!=='Launchwright')throw unsupported('Discovery reply is not from Launchwright');
  if(!record.api||typeof record.api!=='object'||!supportedAppApis.includes(record.api.version))throw unsupported('Unsupported Launchwright application API: '+String(record.api?.version));
  if(record.api.discovery_schema!==record.schema_version)throw unsupported('Discovery schema and API contract disagree');
  if(!Array.isArray(record.operations))throw unsupported('Discovery reply does not enumerate operations');
  const names=new Set(record.operations.map(operation=>operation?.name).filter(Boolean));
  for(const operation of requiredOperations)if(!names.has(operation))throw unsupported('Required operation is unavailable: '+operation);
  return record;
}

export class LaunchwrightClient {
  constructor({baseUrl='http://127.0.0.1:4317',token=null,fetchImpl=globalThis.fetch,timeoutMs=15000,pendingStore=null,supportedDiscoverySchemas=SUPPORTED_DISCOVERY_SCHEMAS,supportedAppApis=SUPPORTED_APP_APIS}={}){
    this.baseUrl=baseUrl.replace(/\/$/,'');this.token=token;this.fetch=fetchImpl===globalThis.fetch?globalThis.fetch.bind(globalThis):fetchImpl;this.timeoutMs=timeoutMs;this.pendingStore=pendingStore;this.supportedDiscoverySchemas=[...supportedDiscoverySchemas];this.supportedAppApis=[...supportedAppApis];
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
  async discovery({requiredOperations=[]}={}){const record=await this.request('/api/v1/discovery',undefined,'GET');return validateDiscovery(record,{requiredOperations,supportedDiscoverySchemas:this.supportedDiscoverySchemas,supportedAppApis:this.supportedAppApis});}
  connect(options){return this.discovery(options);}
  get(id){return this.request('/api/v1/read',{operation:'resource.get',input:{id}});}
  read(operation,input={}){return this.request('/api/v1/read',{operation,input});}
  snapshotSummary(){return this.read('workspace.snapshot');}
  coverage(releaseId){return this.read('release.coverage',{release_id:releaseId});}
  impact(releaseId){return this.read('release.impact',{release_id:releaseId});}
  verificationSummary(candidateId){return this.read('verification.summary',{candidate_id:candidateId});}
  channelStatus(releaseId){return this.read('channel.status',{release_id:releaseId});}
  localizationAssessment(id){return this.read('localization.assess',{id});}
  profileMatrix(){return this.read('profile.matrix');}
  profilePreflight(input){return this.read('profile.preflight',input);}
  extensionDiscovery(input={}){return this.read('extension.discovery',input);}
  negotiateCompatibility(input){return this.read('compatibility.negotiate',input);}
  compatibilityInspect(id){return this.read('compatibility.inspect',{id});}
  mobileInspect(id){return this.read('mobile.inspect',{id});}
  publishInspect(input){return this.read('publish.inspect',input);}
  events({after=0,limit=50,watermark}={}){return this.request('/api/v1/events',{after,limit,...(watermark===undefined?{}:{watermark})});}
  async *eventPages({after=0,limit=50,watermark,maxPages=100}={}){let cursor=after,snapshot=watermark;for(let n=0;n<maxPages;n++){const page=await this.events({after:cursor,limit,...(snapshot===undefined?{}:{watermark:snapshot})});if(snapshot===undefined)snapshot=page.watermark;yield page;if(page.complete)return;if(page.next_after===null)throw new LaunchwrightError({code:'ProtocolMismatch',message:'Incomplete event page has no cursor',outcome_known:true});cursor=page.next_after;}throw new LaunchwrightError({code:'ResourceExhausted',message:'Event page budget reached; resume explicitly',outcome_known:true});}
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
  channelBundleUrl(id){return this.baseUrl+'/api/v1/channel-deliveries/'+encodeURIComponent(id)+'/bundle.zip';}
  deepLink(section,id=null){const part=String(section??'');if(!/^[a-z][a-z0-9-]{0,31}$/.test(part))throw new LaunchwrightError({code:'InvalidArgument',message:'Invalid Launchwright section',outcome_known:true});const base=this.baseUrl||(globalThis.location?.origin??'');if(!base)throw new LaunchwrightError({code:'InvalidArgument',message:'Deep links require an absolute base URL outside the browser',outcome_known:true});const url=new URL(base.endsWith('/')?base:base+'/');url.hash=part+(id?'/'+encodeURIComponent(String(id)):'');return url.toString();}
}
