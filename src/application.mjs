// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import { NativeError, applicationContext, dispatchApplication, requireCondition as ensure, object, integer, requestIdentity, sameVersion, checkCancelled, validateValue } from '@semwright/native-sdk';
import { Store } from './store.mjs';
import { APP_VERSION, RESOURCE, KINDS, EDITABLE, RIGHTS, CLASSES, OPERATION_SCOPES, validateEntity, inputObject, idText, str, lines, array, choice, sha, digest, makeRequest, iso, noSecrets } from './contracts.mjs';
import { renderText } from './render.mjs';
export const PLATFORM_ACTIONS = ['recipes.prepare','recipes.execute','jobs.get','jobs.cancel','jobs.reconcile','evidence.get','artifacts.get','graph.observe','graph.observation','publish.preflight','publish.define','publish.version','publish.deploy','publish.invoke','publish.result'];
const PUBLICATION_ACTIONS = new Set(['publish.define','publish.version','publish.deploy','publish.invoke']);
const READ_ACTIONS = new Set(['jobs.get','evidence.get','artifacts.get','graph.observation','publish.result']);

export class LaunchwrightApplication {
  constructor(root, { initialize = false, readOnly = false, principal = 'local-owner', scopes = ['read','edit','review','publish','admin'], capabilities = {} } = {}) {
    this.store = new Store(root,{initialize,readOnly});
    this.principal=str(principal,128); this.scopes=new Set(scopes); this.capabilities=capabilities;
    this.operations = new Map(Object.keys(OPERATION_SCOPES).map(operation => [operation,(args,context)=>this.invoke(operation,args,context)]));
  }
  close(){this.store.close();}
  allow(scope){ensure(this.scopes.has(scope),'This authenticated application session lacks the required scope','PermissionDenied');}
  get(id,kind){idText(id);const e=this.store.get(id);ensure(!kind||e.kind===kind,'Resource kind differs from the operation contract');return e;}
  list(kind,release){return this.store.all(kind).filter(e=>!release||e.data.release_id===release);}
  productOf(e){if(e.kind==='product')return e.id;if(e.data.product_id)return e.data.product_id;if(e.data.release_id)return this.get(e.data.release_id,'release').data.product_id;return null;}
  assertReferences(kind,d){
    if(d.product_id)this.get(d.product_id,'product');
    const release=d.release_id?this.get(d.release_id,'release'):null;
    const product=d.product_id??release?.data.product_id;
    const ref=(id,type)=>{const e=this.get(id,type);ensure(!product||this.productOf(e)===product,'Cross-product reference is not permitted','PermissionDenied'); if(release&&e.data.release_id)ensure(e.data.release_id===release.id,'Reference belongs to another release');return e;};
    if(d.source_id)ref(d.source_id,'source');
    if(d.target_id)ref(d.target_id,'target');
    if(d.deliverable_id)ref(d.deliverable_id,'deliverable');
    if(d.pinned_artifact_id){const a=ref(d.pinned_artifact_id,'artifact');ensure(a.data.deliverable_id===d.deliverable_id,'Pinned artifact belongs to another deliverable');}
    for(const [field,type]of [['claim_ids','claim'],['source_ids','source'],['evidence_ids','evidence']])for(const id of d[field]??[])ref(id,type);
    if(kind==='claim')for(const id of d.evidence_ids){const e=this.get(id,'evidence');ensure(e.data.target_id===d.target_id,'Evidence target does not match claim');}
    if(kind==='deliverable')for(const id of d.claim_ids)ensure(this.get(id,'claim').data.target_id===d.target_id,'Claim is for another target');
  }
  observe(query,context){
    this.allow('read');checkCancelled(context);
    ensure(query.resource===RESOURCE,'Unknown observable resource','NotFound');
    ensure(query.scope==='all'||KINDS.includes(query.scope),'Unknown observation scope');
    const current=this.store.version();
    if(query.cursor)ensure(sameVersion(query.cursor.version,current),'Observation changed during pagination','StaleReference');
    let after='';
    if(query.cursor){try{const c=JSON.parse(Buffer.from(query.cursor.token,'base64url').toString());object(c,['after','limit'],['after','limit']);ensure(c.limit===query.limit,'Cursor page size changed','StaleReference');after=idText(c.after);}catch(e){if(e instanceof NativeError)throw e;throw new NativeError('StaleReference','Invalid cursor; resync from the first page');}}
    const rows=this.store.all(query.scope).filter(r=>r.id>after);const items=[];let size=1024;
    for(const r of rows){const bytes=Buffer.byteLength(JSON.stringify(r));if(items.length===query.limit||size+bytes>190000)break;items.push(r);size+=bytes;}
    ensure(items.length>0||rows.length===0,'One record exceeds observation budget','ResourceExhausted');
    const complete=items.length===rows.length;
    return{version:current,scope:query.scope,items,complete,next:complete?null:{version:current,scope:query.scope,token:Buffer.from(JSON.stringify({after:items.at(-1).id,limit:query.limit})).toString('base64url')}};
  }
  lookup(identity,context){
    this.allow('read');checkCancelled(context);ensure(identity.resource===RESOURCE,'Unknown recovery resource','NotFound');
    const row=this.store.db.prepare('SELECT * FROM receipts WHERE epoch=? AND key=?').get(identity.epoch,identity.key);
    if(row){ensure(row.digest===identity.request_sha256&&row.principal===this.principal,'Recovery identity differs from its durable binding','Conflict');return{state:'recorded',identity,result:JSON.parse(row.result)};}
    const epoch=this.store.meta().epoch;
    return identity.epoch<epoch?{state:'retention_expired',identity,current_epoch:epoch}:{state:'outcome_unknown',identity};
  }
  describe(){return{app:'Launchwright',version:APP_VERSION,schema_version:'launchwright/1',workspace_version:this.store.version(),request_epoch:this.store.meta().epoch,
    scope_mode:'local-single-owner',principal:this.principal,scopes:[...this.scopes],native_sdk:'0.9.0-dev.1',operations:Object.entries(OPERATION_SCOPES).map(([name,scope])=>({name,scope,read_only:scope==='read'})),
    capabilities:{editorial_text_exports:'available',private_draft_delivery:'available',native_driver_host:'requires-owner-pinned-bundle-and-broker',platform:this.capabilities.platform??'not-connected',canonical_graph:'requires-platform-observation',browser_capture:'requires-canonical-driver-recipe',media_render:'requires-composition-recipe',mobile:'provenance-import-only',public_delivery:'not-implemented',...this.capabilities},
    limits:{page_items:128,reply_bytes:256*1024,artifact_bytes:1024*1024,receipt_epoch_items:20000},disclosure:'Local editorial checks are not Platform approvals or canonical effect verification.'};}
  invoke(operation,args,context){
    const scope=OPERATION_SCOPES[operation];this.allow(scope);checkCancelled(context);
    if(scope==='read')return this.read(operation,args);
    object(args,['request','input'],['request','input']);const request=requestIdentity(args.request);
    ensure(request.resource===RESOURCE,'Request is bound to a different workspace');
    const prepared=makeRequest(operation,args.input,context.expected,request.epoch,request.key);
    ensure(prepared.request.request_sha256===request.request_sha256,'Request digest does not match command, input, revision and identity','Conflict');
    return this.store.transaction(operation,this.principal,request,context.expected,()=>{checkCancelled(context);return this.mutate(operation,args.input,context);});
  }
  read(operation,input){
    switch(operation){
      case'workspace.describe':inputObject(input,[]);return this.describe();
      case'resource.get':inputObject(input,['id']);return this.get(input.id);
      case'events.list':{
        inputObject(input,['after','limit'],[]);const after=integer(input.after??0,0,Number.MAX_SAFE_INTEGER),limit=integer(input.limit??50,1,128);
        const rows=this.store.db.prepare('SELECT * FROM events WHERE seq>? ORDER BY seq LIMIT ?').all(after,limit+1);const more=rows.length>limit;
        const items=rows.slice(0,limit).map(e=>({...e,payload:JSON.parse(e.payload),schema_version:'launchwright-event/1'}));
        return{items,next_after:more?items.at(-1).seq:null,watermark:this.store.db.prepare('SELECT coalesce(max(seq),0) AS n FROM events').get().n,complete:!more};
      }
      case'release.coverage':inputObject(input,['release_id']);return this.coverage(input.release_id);
      case'release.impact':inputObject(input,['release_id']);return this.impact(input.release_id);
      case'candidate.inspect':inputObject(input,['id']);return this.inspectCandidate(this.get(input.id,'candidate'));
      case'artifact.read':{
        inputObject(input,['id']);const a=this.get(input.id,'artifact');const b=this.store.readBlob(a.data.sha256);
        ensure(b.bytes.length<=160000,'Use authenticated artifact download for this output','ResourceExhausted');return{artifact:a,text:b.bytes.toString('utf8')};
      }
      default:throw new NativeError('Unsupported','Unknown read operation');
    }
  }
  dependencies(deliverable){
    const d=deliverable.data;const entries=[deliverable,this.get(d.release_id,'release'),this.get(d.target_id,'target')];
    for(const id of d.source_ids)entries.push(this.get(id,'source'));
    for(const id of d.claim_ids){const c=this.get(id,'claim');entries.push(c);for(const eid of c.data.evidence_ids)entries.push(this.get(eid,'evidence'));}
    return[...new Map(entries.map(e=>[e.id,{id:e.id,kind:e.kind,version:e.version}])).values()].sort((a,b)=>a.id.localeCompare(b.id));
  }
  freshness(pins){const changed=[];for(const p of pins){let now;try{now=this.get(p.id);}catch{changed.push({id:p.id,reason:'missing'});continue;}if(!sameVersion(now.version,p.version))changed.push({id:p.id,reason:'revision-changed',expected:p.version,observed:now.version});}return changed;}
  claimCheck(claim){
    const c=claim.data;const release=this.get(c.release_id,'release');const target=this.get(c.target_id,'target');
    const evidence=c.evidence_ids.map(id=>this.get(id,'evidence'));
    const reasons=[];
    if(!evidence.length)reasons.push('no-evidence');
    for(const e of evidence){if(e.data.build!==release.data.build)reasons.push('build-mismatch');if(!sameVersion(e.data.target_version,target.version))reasons.push('target-revision-changed');if(!['owned','licensed'].includes(e.data.rights))reasons.push('rights-unresolved');if(e.data.technical!=='PASS')reasons.push('technical-verification-unknown');}
    // Imported assertions can NEVER confer canonical PASS. Actual verification must come from a future supported effects adapter.
    return{claim_id:claim.id,target_id:c.target_id,status:'UNKNOWN',reasons:[...new Set([...reasons,'canonical-claim-verifier-unavailable'])],evidence_count:evidence.length,category:c.category};
  }
  coverage(releaseId){
    this.get(releaseId,'release');const claims=this.list('claim',releaseId).map(c=>this.claimCheck(c));const scenarios=this.list('scenario',releaseId);
    return{release_id:releaseId,claims,obligations:claims.length,pass:claims.filter(c=>c.status==='PASS').length,fail:claims.filter(c=>c.status==='FAIL').length,unknown:claims.filter(c=>c.status==='UNKNOWN').length,
      scenarios:scenarios.map(s=>({id:s.id,status:'UNKNOWN',reason:'canonical-execution-not-observed'})),inventory_scope:'registered-only',unknown_frontier:true,canonical_graph_authority:false};
  }
  impact(releaseId){
    this.get(releaseId,'release');const items=[];
    for(const a of this.list('artifact',releaseId)){const changed=this.freshness(a.data.inputs);if(changed.length)items.push({artifact_id:a.id,deliverable_id:a.data.deliverable_id,state:'INPUTS_CHANGED',changed});}
    const bindings=this.list('binding',releaseId).map(b=>({binding_id:b.id,mode:b.data.mode,action:b.data.mode==='rolling'?'revalidate-if-inputs-changed':'retain-pinned-history',pinned_artifact_id:b.data.pinned_artifact_id??null}));
    return{release_id:releaseId,items,bindings,coverage:'DECLARED_DEPENDENCIES_ONLY',canonical_graph_authority:false,unknown_frontier:true,note:'This is an app input-revision comparison, not a Project Graph freshness verdict.'};
  }
  candidateGates(candidate){
    const changed=this.freshness(candidate.data.manifest.inputs);
    const gates=[{name:'input-versions',state:changed.length?'FAIL':'PASS',details:changed},{name:'artifact-bytes',state:'PASS',details:[]}];
    for(const id of candidate.data.manifest.artifact_ids){const a=this.get(id,'artifact');try{this.store.readBlob(a.data.sha256);}catch{gates[1].state='FAIL';gates[1].details.push(id);}}
    const claims=candidate.data.manifest.claim_ids.map(id=>this.claimCheck(this.get(id,'claim')));
    gates.push({name:'technical-claims',state:claims.length?'UNKNOWN':'PASS',details:claims});
    gates.push({name:'external-capture-coverage',state:'UNKNOWN',details:['Local text generation does not establish capture, media or complete product coverage.']});
    return gates;
  }
  inspectCandidate(candidate){const gates=this.candidateGates(candidate);const reviews=this.list('review',candidate.data.release_id).filter(r=>r.data.candidate_id===candidate.id);
    return{candidate,gates,reviews,fresh:!gates.some(g=>g.name==='input-versions'&&g.state==='FAIL'),external_publication_allowed:false,private_draft_allowed:!gates.some(g=>g.state==='FAIL'),technical_state:gates.some(g=>g.state==='FAIL')?'FAIL':'UNKNOWN'};}
  mutate(operation,input){
    switch(operation){
      case'entity.create':{inputObject(input,['kind','data']);choice(input.kind,EDITABLE);const data=validateEntity(input.kind,input.data);this.assertReferences(input.kind,data);return{entity:this.store.create(input.kind,data)};}
      case'entity.update':{
        inputObject(input,['id','expected','data']);const e=this.get(input.id);ensure(EDITABLE.includes(e.kind),'Immutable resource cannot be edited','PermissionDenied');
        ensure(sameVersion(e.version,input.expected),'Entity revision changed','StaleReference');const data=validateEntity(e.kind,input.data);
        for(const parent of ['product_id','release_id'])ensure(e.data[parent]===data[parent],'Resource parent is immutable');this.assertReferences(e.kind,data);
        return{entity:this.store.update(e.id,e.data.template_origin?{...data,template_origin:e.data.template_origin}:data)};
      }
      case'evidence.import':{
        inputObject(input,['release_id','target_id','source_id','name','build','classification','rights','description','origin_digest','job_id'],['release_id','target_id','source_id','name','build','classification','rights','description','origin_digest']);
        const release=this.get(input.release_id,'release'),target=this.get(input.target_id,'target'),source=this.get(input.source_id,'source');
        ensure(target.data.release_id===release.id&&source.data.product_id===release.data.product_id,'Evidence scope mismatch');
        choice(input.classification,CLASSES);choice(input.rights,RIGHTS);str(input.name,160);str(input.build,256);lines(input.description,8000);sha(input.origin_digest);
        if(input.job_id)str(input.job_id,96);
        return{entity:this.store.create('evidence',{...input,target_version:target.version,source_version:source.version,admission:'imported-declaration',technical:'UNKNOWN',host_acceptance:'NOT_ESTABLISHED',rights_basis:'operator-declaration',observed_at:iso()})};
      }
      case'deliverable.render':{
        inputObject(input,['id']);const d=this.get(input.id,'deliverable'),r=this.get(d.data.release_id,'release'),t=this.get(d.data.target_id,'target');
        const rendered=renderText(d,t,r);const hash=this.store.blob(rendered.bytes,rendered.mime);
        return{entity:this.store.create('artifact',{name:d.data.name,release_id:r.id,target_id:t.id,deliverable_id:d.id,sha256:hash,size_bytes:rendered.bytes.length,mime:rendered.mime,extension:rendered.extension,inputs:this.dependencies(d),classification:'editorial',producer:'launchwright-text/1',draft:true,technical:'UNKNOWN'})};
      }
      case'candidate.freeze':{
        inputObject(input,['release_id','name','artifact_ids','destination','contract']);this.get(input.release_id,'release');str(input.name,160);str(input.destination,96);ensure(/^[a-z0-9][a-z0-9_-]{0,95}$/.test(input.destination),'Destination must be a local alias identifier');
        array(input.artifact_ids,32);ensure(input.artifact_ids.length>0&&new Set(input.artifact_ids).size===input.artifact_ids.length,'Candidate requires unique artifacts');
        object(input.contract,['version','required_reviewers','require_claims_verified'],['version','required_reviewers','require_claims_verified']);str(input.contract.version,64);integer(input.contract.required_reviewers,1,8);ensure(typeof input.contract.require_claims_verified==='boolean','Contract requires an explicit claims policy');
        const artifacts=input.artifact_ids.map(id=>this.get(id,'artifact'));const inputs=new Map();const claimIds=new Set();
        for(const a of artifacts){ensure(a.data.release_id===input.release_id,'Candidate artifact belongs to another release');ensure(this.freshness(a.data.inputs).length===0,'An artifact has changed inputs; render a new version','StaleReference');this.store.readBlob(a.data.sha256);for(const pin of a.data.inputs){inputs.set(pin.id,pin);if(pin.kind==='claim')claimIds.add(pin.id);}}
        const manifest={schema_version:'launchwright-candidate/1',release_id:input.release_id,artifact_ids:[...input.artifact_ids].sort(),artifacts:artifacts.map(a=>({id:a.id,sha256:a.data.sha256,bytes:a.data.size_bytes})).sort((a,b)=>a.id.localeCompare(b.id)),inputs:[...inputs.values()].sort((a,b)=>a.id.localeCompare(b.id)),claim_ids:[...claimIds].sort(),destination:input.destination,contract:input.contract};
        const hash=digest('candidate',manifest);return{entity:this.store.create('candidate',{release_id:input.release_id,name:input.name,manifest,candidate_sha256:hash,frozen_at:iso(),publication_class:'private-draft-only'})};
      }
      case'candidate.review':{
        inputObject(input,['id','candidate_sha256','decision','comment']);const c=this.get(input.id,'candidate');sha(input.candidate_sha256);ensure(c.data.candidate_sha256===input.candidate_sha256,'Review candidate digest mismatch','Conflict');choice(input.decision,['approve-editorial','request-changes','reject']);lines(input.comment,8000);
        ensure(this.freshness(c.data.manifest.inputs).length===0,'Candidate inputs changed; a new candidate is required','StaleReference');
        return{entity:this.store.create('review',{release_id:c.data.release_id,name:`${input.decision} · ${this.principal}`,candidate_id:c.id,candidate_sha256:c.data.candidate_sha256,decision:input.decision,comment:input.comment,decision_order:this.store.version().revision,reviewer:this.principal,authority:'local-editorial-only',technical_waiver:false})};
      }
      case'candidate.deliver_private':{
        inputObject(input,['id','candidate_sha256','alias_expected','acknowledge_draft']);const c=this.get(input.id,'candidate');ensure(input.candidate_sha256===c.data.candidate_sha256,'Candidate digest differs','Conflict');ensure(input.acknowledge_draft===true,'Private delivery is a draft, not a verified launch','ConsentRequired');
        const checked=this.inspectCandidate(c);ensure(checked.private_draft_allowed,'Candidate has stale inputs or invalid bytes','StaleReference');
        const latest=new Map();for(const r of checked.reviews.sort((a,b)=>BigInt(a.data.decision_order)<BigInt(b.data.decision_order)?-1:1))latest.set(r.data.reviewer,r);
        const decisions=[...latest.values()];ensure(!decisions.some(r=>r.data.decision!=='approve-editorial')&&decisions.length>=c.data.manifest.contract.required_reviewers,'Required editorial reviews are missing or request changes','PermissionDenied');
        ensure(!c.data.manifest.contract.require_claims_verified||!c.data.manifest.claim_ids.length,'Contract requires verified claims, but canonical claim verification is unavailable','PolicyDenied');
        const name=c.data.manifest.destination;const row=this.store.db.prepare('SELECT * FROM aliases WHERE name=?').get(name);
        if(row){ensure(input.alias_expected&&sameVersion(input.alias_expected,{resource:`alias:${name}`,generation:row.generation,revision:row.revision}),'Private alias changed','StaleReference');}
        else ensure(input.alias_expected===null,'Private alias did not exist','StaleReference');
        const generation=row?.generation??randomUUID(),revision=row?(BigInt(row.revision)+1n).toString():'1';
        this.store.db.prepare('INSERT INTO aliases VALUES(?,?,?,?) ON CONFLICT(name) DO UPDATE SET revision=excluded.revision,candidate_id=excluded.candidate_id').run(name,generation,revision,c.id);
        return{entity:this.store.create('delivery',{release_id:c.data.release_id,name,candidate_id:c.id,candidate_sha256:c.data.candidate_sha256,state:'PRIVATE_DRAFT_RECORDED',external_state:'NOT_SENT',alias_version:{resource:`alias:${name}`,generation,revision},artifact_ids:c.data.manifest.artifact_ids,technical_state:checked.technical_state,delivered_by:this.principal})};
      }
      case'template.instantiate':{
        inputObject(input,['id','release_id','target_id','parameters','name']);const template=this.get(input.id,'template');object(input.parameters,template.data.parameters,template.data.parameters);for(const value of Object.values(input.parameters))str(value,4000);
        const d={release_id:input.release_id,target_id:input.target_id,name:str(input.name,160),format:template.data.format,content:template.data.content.replace(/\{\{([a-z][a-z0-9_]*)\}\}/g,(_,key)=>{ensure(Object.hasOwn(input.parameters,key),'Template contains an undeclared parameter');return input.parameters[key];}),claim_ids:[],source_ids:[]};
        validateEntity('deliverable',d);this.assertReferences('deliverable',d);
        return{entity:this.store.create('deliverable',{...d,template_origin:{id:template.id,version:template.version,parameters_sha256:digest('template-parameters',input.parameters)}}),template_pin:template.version};
      }
      case'work.prepare':{
        inputObject(input,['release_id','name','action','arguments','budget','authorization'],['release_id','name','action','arguments','budget']);this.get(input.release_id,'release');str(input.name,160);choice(input.action,PLATFORM_ACTIONS);object(input.arguments);noSecrets(input.arguments);object(input.budget,['max_cost_microunits','currency','max_runtime_seconds'],['max_cost_microunits','currency','max_runtime_seconds']);integer(input.budget.max_cost_microunits,0,1000000000);str(input.budget.currency,8);integer(input.budget.max_runtime_seconds,1,3600);
        // This record is only an intent and budget proposal. Platform enforces actual execution authority and costs.
        if(PUBLICATION_ACTIONS.has(input.action)){this.allow('publish');ensure(input.authorization==='explicit-publication','External publication requires explicit per-intent authorization','ConsentRequired');}
        return{entity:this.store.create('work',{...input,state:'PREPARED',authority:'platform-required',budget_enforced:false,platform_job_id:null,pending_digest:null})};
      }
      case'work.claim':{
        inputObject(input,['id','prepared_record']);const w=this.get(input.id,'work');ensure(w.data.state==='PREPARED','Work has already been claimed; recover rather than resend','Conflict');object(input.prepared_record);noSecrets(input.prepared_record);
        const pending=digest('pending',input.prepared_record);this.store.db.prepare('INSERT INTO pending VALUES(?,?,?)').run(w.id,JSON.stringify(input.prepared_record),'CLAIMED');
        return{entity:this.store.update(w.id,{...w.data,state:'CLAIMED',pending_digest:pending}),pending_digest:pending};
      }
      case'work.complete':{
        inputObject(input,['id','result','pending_digest']);const w=this.get(input.id,'work');ensure(['CLAIMED','OUTCOME_UNKNOWN'].includes(w.data.state),'Work is not awaiting an outcome','Conflict');ensure(w.data.pending_digest===input.pending_digest,'Pending request binding differs','Conflict');object(input.result);
        const job=input.result.job_id??null;if(job)str(job,96);
        // Saved SDK response is a projection, not promotion into technical evidence or effect PASS.
        return{entity:this.store.update(w.id,{...w.data,state:'RESPONSE_RECORDED',platform_job_id:job,result:input.result,evidence_trust:'NOT_ADMITTED'})};
      }
      case'work.mark_unknown':{
        inputObject(input,['id']);const w=this.get(input.id,'work');ensure(['CLAIMED','OUTCOME_UNKNOWN'].includes(w.data.state),'Only claimed work can have an unknown send outcome','Conflict');return{entity:this.store.update(w.id,{...w.data,state:'OUTCOME_UNKNOWN'})};
      }
      case'workspace.rotate_epoch':{
        inputObject(input,['expected_epoch']);integer(input.expected_epoch,0,Number.MAX_SAFE_INTEGER-1);ensure(this.store.meta().epoch===input.expected_epoch,'Request epoch changed','Conflict');
        const next=input.expected_epoch+1;this.store.db.prepare('UPDATE meta SET epoch=? WHERE singleton=1').run(next);this.store.db.prepare('DELETE FROM receipts WHERE epoch<?').run(Math.max(0,next-1));return{request_epoch:next};
      }
      default:throw new NativeError('Unsupported','Operation not implemented');
    }
  }
}
// Human/API/CLI/native calls all use the canonical dispatcher, including cancellation and reply validation.
export async function execute(app,operation,input,{key=randomUUID(),expected=app.store.version(),epoch=app.store.meta().epoch,signal}={}){
  const args=OPERATION_SCOPES[operation]==='read'?input:makeRequest(operation,input,expected,epoch,key);
  return dispatchApplication(app,'invoke',operation,args,applicationContext(key,expected,signal));
}
export { RESOURCE, APP_VERSION, READ_ACTIONS, PUBLICATION_ACTIONS };
