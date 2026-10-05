// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import { NativeError, applicationContext, dispatchApplication, requireCondition as ensure, object, integer, requestIdentity, sameVersion, checkCancelled, validateValue } from '@semwright/native-sdk';
import { Store } from './store.mjs';
import { APP_VERSION, RESOURCE, KINDS, EDITABLE, RIGHTS, CLASSES, OPERATION_SCOPES, validateEntity, inputObject, idText, str, lines, array, choice, sha, digest, makeRequest, iso, noSecrets } from './contracts.mjs';
import { renderText } from './render.mjs';
import { createStoredZip } from './zip.mjs';
export const PLATFORM_ACTIONS = 'recipes.prepare recipes.execute jobs.get jobs.cancel jobs.reconcile evidence.get artifacts.get graph.observe graph.observation publish.preflight publish.define publish.version publish.deploy publish.invoke publish.result'.split(' ');
const PUBLICATION_ACTIONS = new Set('publish.define publish.version publish.deploy publish.invoke'.split(' '));
const READ_ACTIONS = new Set('jobs.get evidence.get artifacts.get graph.observation publish.result'.split(' '));

export class LaunchwrightApplication {
  constructor(root, { initialize = false, readOnly = false, principal = 'local-owner', scopes = ['read','edit','review','publish','admin'], capabilities = {} } = {}) {
    this.s=this.store=new Store(root,{initialize,readOnly});
    this.principal=str(principal,128); this.scopes=new Set(scopes); this.capabilities=capabilities;
    this.operations = new Map(Object.keys(OPERATION_SCOPES).map(operation => [operation,(args,context)=>this.invoke(operation,args,context)]));
  }
  close(){this.s.close();}
  allow(scope){ensure(this.scopes.has(scope),'Scope denied','PermissionDenied');}
  g(id,kind){idText(id);const e=this.s.get(id);ensure(!kind||e.kind===kind,'Wrong resource kind');return e;}
  get(id,kind){return this.g(id,kind);}
  l(kind,release){return this.s.all(kind).filter(e=>!release||e.data.release_id===release);}
  list(kind,release){return this.l(kind,release);}
  productOf(e){if(e.kind==='product')return e.id;if(e.data.product_id)return e.data.product_id;if(e.data.release_id)return this.g(e.data.release_id,'release').data.product_id;return null;}
  assertReferences(kind,d){
    if(d.product_id)this.g(d.product_id,'product');
    const release=d.release_id?this.g(d.release_id,'release'):null;
    const product=d.product_id??release?.data.product_id;
    const ref=(id,type)=>{const e=this.g(id,type);ensure(!product||this.productOf(e)===product,'Cross-product reference','PermissionDenied'); if(release&&e.data.release_id)ensure(e.data.release_id===release.id,'Wrong release');return e;};
    if(d.build_id)ref(d.build_id,'build');
    if(d.source_id)ref(d.source_id,'source');
    if(d.target_id)ref(d.target_id,'target');
    if(d.feature_id)ref(d.feature_id,'feature');
    if(d.availability_id)ref(d.availability_id,'availability');
    if(d.claim_id)ref(d.claim_id,'claim');
    if(d.deliverable_id)ref(d.deliverable_id,'deliverable');
    if(d.pinned_artifact_id){const a=ref(d.pinned_artifact_id,'artifact');ensure(a.data.deliverable_id===d.deliverable_id,'Artifact/deliverable mismatch');}
    for(const [field,type]of [['claim_ids','claim'],['copy_block_ids','copy_block'],['source_ids','source'],['evidence_ids','evidence'],['required_claim_ids','claim'],['optional_claim_ids','claim'],['required_deliverable_ids','deliverable']])for(const id of d[field]??[])ref(id,type);
    if(kind==='availability'){
      ensure(this.g(d.feature_id,'feature').data.release_id===d.release_id,'Feature/release mismatch');
      ensure(this.g(d.target_id,'target').data.release_id===d.release_id,'Target/release mismatch');
    }
    if(kind==='anchor')ensure(this.g(d.target_id,'target').data.release_id===d.release_id,'Target/release mismatch');
    if(kind==='claim'){
      for(const id of d.evidence_ids){const e=this.g(id,'evidence');ensure(e.data.target_id===d.target_id,'Evidence/claim target mismatch');}
      if(d.availability_id)ensure(this.g(d.availability_id,'availability').data.target_id===d.target_id,'Availability/claim target mismatch');
    }
    if(kind==='copy_block')ensure(this.g(d.claim_id,'claim').data.target_id===d.target_id,'Copy/claim target mismatch');
    if(kind==='deliverable'){
      for(const id of d.claim_ids)ensure(this.g(id,'claim').data.target_id===d.target_id,'Claim target mismatch');
      for(const id of d.copy_block_ids??[])ensure(this.g(id,'copy_block').data.target_id===d.target_id,'Copy target mismatch');
    }
  }
  observe(query,context){
    this.allow('read');checkCancelled(context);
    ensure(query.resource===RESOURCE,'Unknown resource','NotFound');
    ensure(query.scope==='all'||KINDS.includes(query.scope),'Unknown scope');
    const current=this.s.version();
    if(query.cursor)ensure(sameVersion(query.cursor.version,current),'Observation changed','StaleReference');
    let after='';
    if(query.cursor){try{const c=JSON.parse(Buffer.from(query.cursor.token,'base64url').toString());object(c,['after','limit'],['after','limit']);ensure(c.limit===query.limit,'Cursor size changed','StaleReference');after=idText(c.after);}catch(e){if(e instanceof NativeError)throw e;throw new NativeError('StaleReference','Invalid cursor');}}
    const rows=this.s.all(query.scope).filter(r=>r.id>after);const items=[];let size=1024;
    for(const r of rows){const bytes=Buffer.byteLength(JSON.stringify(r));if(items.length===query.limit||size+bytes>190000)break;items.push(r);size+=bytes;}
    ensure(items.length>0||rows.length===0,'Record exceeds page budget','ResourceExhausted');
    const complete=items.length===rows.length;
    return{version:current,scope:query.scope,items,complete,next:complete?null:{version:current,scope:query.scope,token:Buffer.from(JSON.stringify({after:items.at(-1).id,limit:query.limit})).toString('base64url')}};
  }
  lookup(identity,context){
    this.allow('read');checkCancelled(context);ensure(identity.resource===RESOURCE,'Unknown recovery resource','NotFound');
    const row=this.s.db.prepare('SELECT * FROM receipts WHERE epoch=? AND key=?').get(identity.epoch,identity.key);
    if(row){ensure(row.digest===identity.request_sha256&&row.principal===this.principal,'Recovery binding mismatch','Conflict');return{state:'recorded',identity,result:JSON.parse(row.result)};}
    const epoch=this.s.meta().epoch;
    return identity.epoch<epoch?{state:'retention_expired',identity,current_epoch:epoch}:{state:'outcome_unknown',identity};
  }
  describe(){return{app:'Launchwright',version:APP_VERSION,schema_version:'launchwright/1',workspace_version:this.s.version(),request_epoch:this.s.meta().epoch,
    scope_mode:'local-single-owner',principal:this.principal,scopes:[...this.scopes],native_sdk:'0.9.0-dev.1',operations:Object.entries(OPERATION_SCOPES).map(([name,scope])=>({name,scope,read_only:scope==='read'})),
    capabilities:{editorial_text_exports:'available',private_draft_delivery:'available',declared_release_contracts:'available',state_anchors:'contract-and-assessment-only',impact_proposals:'available-no-execution-authority',native_driver_host:'requires-owner-pinned-bundle-and-broker',platform:this.capabilities.platform??'not-connected',canonical_graph:'requires-platform-observation',browser_capture:'requires-canonical-driver-recipe',media_render:'requires-composition-recipe',mobile:'provenance-import-only',public_delivery:'not-implemented',...this.capabilities},
    limits:{page_items:128,reply_bytes:256*1024,artifact_bytes:1024*1024,receipt_epoch_items:20000},disclosure:'Local checks are not canonical verification.'};}
  invoke(operation,args,context){
    const scope=OPERATION_SCOPES[operation];this.allow(scope);checkCancelled(context);
    if(scope==='read')return this.read(operation,args);
    object(args,['request','input'],['request','input']);const request=requestIdentity(args.request);
    ensure(request.resource===RESOURCE,'Wrong workspace');
    const prepared=makeRequest(operation,args.input,context.expected,request.epoch,request.key);
    ensure(prepared.request.request_sha256===request.request_sha256,'Request digest mismatch','Conflict');
    return this.s.transaction(operation,this.principal,request,context.expected,()=>{checkCancelled(context);return this.mutate(operation,args.input,context);});
  }
  read(operation,input){
    switch(operation){
      case'workspace.describe':inputObject(input,[]);return this.describe();
      case'resource.get':inputObject(input,['id']);return this.g(input.id);
      case'events.list':{
        inputObject(input,['after','limit'],[]);const after=integer(input.after??0,0,Number.MAX_SAFE_INTEGER),limit=integer(input.limit??50,1,128);
        const rows=this.s.db.prepare('SELECT * FROM events WHERE seq>? ORDER BY seq LIMIT ?').all(after,limit+1);const more=rows.length>limit;
        const items=rows.slice(0,limit).map(e=>({...e,payload:JSON.parse(e.payload),schema_version:'launchwright-event/1'}));
        return{items,next_after:more?items.at(-1).seq:null,watermark:this.s.db.prepare('SELECT coalesce(max(seq),0) AS n FROM events').get().n,complete:!more};
      }
      case'release.coverage':inputObject(input,['release_id']);return this.coverage(input.release_id);
      case'release.impact':inputObject(input,['release_id']);return this.impact(input.release_id);
      case'anchor.assess':{
        inputObject(input,['id','observed_matches']);const anchor=this.g(input.id,'anchor');const observed=integer(input.observed_matches,0,1000);
        const expected=anchor.data.expected_count,state=observed===expected?'PASS':'FAIL';
        return{anchor_id:anchor.id,state,expected_count:expected,observed_matches:observed,unique:state==='PASS',selected:state==='PASS',reason:state==='PASS'?'unique-anchor':'anchor-cardinality-mismatch'};
      }
      case'candidate.inspect':inputObject(input,['id']);return this.inspectCandidate(this.g(input.id,'candidate'));
      case'artifact.read':{
        inputObject(input,['id']);const a=this.g(input.id,'artifact');const b=this.s.readBlob(a.data.sha256);
        ensure(b.bytes.length<=160000,'Artifact too large for inline read','ResourceExhausted');return{artifact:a,text:b.bytes.toString('utf8')};
      }
      default:throw new NativeError('Unsupported','Unknown read operation');
    }
  }
  dependencies(deliverable){
    const d=deliverable.data;const entries=[deliverable,this.g(d.release_id,'release'),this.g(d.target_id,'target')];
    const addClaim=id=>{const c=this.g(id,'claim');entries.push(c);if(c.data.availability_id)entries.push(this.g(c.data.availability_id,'availability'));for(const eid of c.data.evidence_ids)entries.push(this.g(eid,'evidence'));};
    for(const id of d.source_ids)entries.push(this.g(id,'source'));
    for(const id of d.claim_ids)addClaim(id);
    for(const id of d.copy_block_ids??[]){const block=this.g(id,'copy_block');entries.push(block);addClaim(block.data.claim_id);}
    return[...new Map(entries.map(e=>[e.id,{id:e.id,kind:e.kind,version:e.version}])).values()].sort((a,b)=>a.id.localeCompare(b.id));
  }
  freshness(pins){const changed=[];for(const p of pins){let now;try{now=this.g(p.id);}catch{changed.push({id:p.id,reason:'missing'});continue;}if(!sameVersion(now.version,p.version))changed.push({id:p.id,reason:'revision-changed',expected:p.version,observed:now.version});}return changed;}
  claimCheck(claim){
    const c=claim.data;const release=this.g(c.release_id,'release');const target=this.g(c.target_id,'target');
    const evidence=c.evidence_ids.map(id=>this.g(id,'evidence'));
    const reasons=[];
    if(!evidence.length)reasons.push('no-evidence');
    for(const e of evidence){if(e.data.build!==release.data.build)reasons.push('build-mismatch');if(!sameVersion(e.data.target_version,target.version))reasons.push('target-revision-changed');if(!['owned','licensed'].includes(e.data.rights))reasons.push('rights-unresolved');if(e.data.technical!=='PASS')reasons.push('technical-verification-unknown');}
    if(c.valid_until&&Date.parse(c.valid_until)<=Date.now())reasons.push('claim-validity-expired');
    if(c.availability_id){
      const a=this.g(c.availability_id,'availability');
      if(a.data.target_id!==c.target_id)reasons.push('availability-target-mismatch');
      if(a.data.valid_until&&Date.parse(a.data.valid_until)<=Date.now())reasons.push('availability-validity-expired');
      if(a.data.state==='unavailable')reasons.push('declared-availability-contradiction');
      if(a.data.state==='unknown')reasons.push('declared-availability-unknown');
      if(a.data.basis!=='observed')reasons.push('availability-not-observed');
    }
    const status=reasons.includes('declared-availability-contradiction')?'FAIL':'UNKNOWN';
    return{claim_id:claim.id,target_id:c.target_id,status,reasons:[...new Set([...reasons,'canonical-claim-verifier-unavailable'])],evidence_count:evidence.length,category:c.category};
  }
  coverage(releaseId){
    this.g(releaseId,'release');const claimEntities=this.l('claim',releaseId),claims=claimEntities.map(c=>this.claimCheck(c));const byClaim=new Map(claims.map(c=>[c.claim_id,c]));const scenarios=this.l('scenario',releaseId);
    const contracts=this.l('release_contract',releaseId).map(contract=>{
      const obligations=[];
      for(const id of contract.data.required_claim_ids){const check=byClaim.get(id)??{status:'UNKNOWN',reasons:['claim-not-enumerated']};obligations.push({kind:'claim',id,state:check.status,reasons:check.reasons});}
      for(const id of contract.data.required_deliverable_ids){
        const artifacts=this.l('artifact',releaseId).filter(a=>a.data.deliverable_id===id);let state='UNKNOWN',reasons=['no-current-artifact'];
        for(const artifact of artifacts){const changed=this.freshness(artifact.data.inputs);if(changed.length)continue;try{this.s.readBlob(artifact.data.sha256);state='PASS';reasons=[];break;}catch{state='FAIL';reasons=['artifact-integrity-failed'];}}
        obligations.push({kind:'deliverable',id,state,reasons});
      }
      return{id:contract.id,name:contract.data.name,total:obligations.length,ready:obligations.filter(o=>o.state==='PASS').length,failed:obligations.filter(o=>o.state==='FAIL').length,unknown:obligations.filter(o=>o.state==='UNKNOWN').length,obligations,optional_claim_ids:contract.data.optional_claim_ids};
    });
    return{release_id:releaseId,claims,obligations:claims.length,pass:claims.filter(c=>c.status==='PASS').length,fail:claims.filter(c=>c.status==='FAIL').length,unknown:claims.filter(c=>c.status==='UNKNOWN').length,contracts,
      scenarios:scenarios.map(s=>({id:s.id,status:'UNKNOWN',reason:'canonical-execution-not-observed'})),inventory_scope:'registered-only',unknown_frontier:true,canonical_graph_authority:false};
  }
  impact(releaseId){
    this.g(releaseId,'release');const items=[];
    for(const a of this.l('artifact',releaseId)){const changed=this.freshness(a.data.inputs);if(changed.length)items.push({artifact_id:a.id,deliverable_id:a.data.deliverable_id,state:'INPUTS_CHANGED',changed});}
    const bindings=this.l('binding',releaseId).map(b=>({binding_id:b.id,mode:b.data.mode,action:b.data.mode==='rolling'?'revalidate-if-inputs-changed':'retain-pinned-history',pinned_artifact_id:b.data.pinned_artifact_id??null}));
    const contracts=this.coverage(releaseId).contracts;
    const contract_blockers=contracts.flatMap(c=>c.obligations.filter(o=>o.state!=='PASS').map(o=>({contract_id:c.id,...o})));
    const relations=this.l('relation',releaseId).map(r=>({id:r.id,from_id:r.data.from_id,to_id:r.data.to_id,kind:r.data.relation_kind,provenance:r.data.provenance,completeness:r.data.completeness,admission:r.data.admission}));
    return{release_id:releaseId,items,bindings,contract_blockers,relations,coverage:'DECLARED_DEPENDENCIES_ONLY',canonical_graph_authority:false,unknown_frontier:true,note:'Local impact uses declared inputs; canonical Graph authority is external.'};
  }
  candidateGates(candidate){
    const changed=this.freshness(candidate.data.manifest.inputs);
    const gates=[{name:'input-versions',state:changed.length?'FAIL':'PASS',details:changed},{name:'artifact-bytes',state:'PASS',details:[]}];
    for(const id of candidate.data.manifest.artifact_ids){const a=this.g(id,'artifact');try{this.s.readBlob(a.data.sha256);}catch{gates[1].state='FAIL';gates[1].details.push(id);}}
    const claims=candidate.data.manifest.claim_ids.map(id=>this.claimCheck(this.g(id,'claim')));
    gates.push({name:'technical-claims',state:claims.length?'UNKNOWN':'PASS',details:claims});
    gates.push({name:'external-capture-coverage',state:'UNKNOWN',details:['Local text is not capture or media evidence.']});
    return gates;
  }
  inspectCandidate(candidate){
    const gates=this.candidateGates(candidate),reviews=this.l('review',candidate.data.release_id).filter(r=>r.data.candidate_id===candidate.id);
    const latest=new Map();
    for(const r of [...reviews].sort((a,b)=>BigInt(a.data.decision_order)<BigInt(b.data.decision_order)?-1:1))latest.set(`${r.data.dimension??'editorial'}:${r.data.reviewer}`,r);
    const required=candidate.data.manifest.contract.required_dimensions??['editorial'],needed=candidate.data.manifest.contract.required_reviewers;
    const review_dimensions={};
    for(const dimension of ['technical','editorial','permissions']){
      const decisions=[...latest.values()].filter(r=>(r.data.dimension??'editorial')===dimension);
      const approvals=decisions.filter(r=>r.data.decision==='approve').length;
      const blocked=decisions.some(r=>r.data.decision!=='approve');
      review_dimensions[dimension]={required:required.includes(dimension),required_reviewers:required.includes(dimension)?needed:0,approvals,state:blocked?'CHANGES_REQUESTED':approvals>=(required.includes(dimension)?needed:1)?'APPROVED':'PENDING',decisions};
    }
    const fresh=!gates.some(g=>g.name==='input-versions'&&g.state==='FAIL'),review_ready=required.every(d=>review_dimensions[d].state==='APPROVED');
    return{candidate,gates,reviews,review_dimensions,required_review_dimensions:required,review_ready,fresh,external_publication_allowed:false,private_draft_allowed:fresh&&!gates.some(g=>g.state==='artifact-bytes'&&g.state==='FAIL'),technical_state:gates.some(g=>g.state==='FAIL')?'FAIL':'UNKNOWN'};
  }
  mutate(operation,input){
    switch(operation){
      case'entity.create':{inputObject(input,['kind','data']);choice(input.kind,EDITABLE);const data=validateEntity(input.kind,input.data);this.assertReferences(input.kind,data);return{entity:this.s.create(input.kind,data)};}
      case'entity.update':{
        inputObject(input,['id','expected','data']);const e=this.g(input.id);ensure(EDITABLE.includes(e.kind),'Immutable resource cannot be edited','PermissionDenied');
        ensure(sameVersion(e.version,input.expected),'Entity revision changed','StaleReference');const data=validateEntity(e.kind,input.data);
        for(const parent of ['product_id','release_id'])ensure(e.data[parent]===data[parent],'Resource parent is immutable');this.assertReferences(e.kind,data);
        return{entity:this.s.update(e.id,e.data.template_origin?{...data,template_origin:e.data.template_origin}:data)};
      }
      case'entity.retire':{
        inputObject(input,['id','expected','reason']);const e=this.g(input.id);ensure(EDITABLE.includes(e.kind),'Resource is not retireable','PermissionDenied');
        ensure(sameVersion(e.version,input.expected),'Entity revision changed','StaleReference');lines(input.reason,4000);
        if(['product','release'].includes(e.kind)){const children=this.s.all().filter(x=>x.kind!=='tombstone'&&(x.data.product_id===e.id||x.data.release_id===e.id));ensure(children.length===0,'Active children remain','Conflict');}
        return{entity:this.s.retire(e.id,{subject_id:e.id,original_kind:e.kind,retired_at:iso(),reason:input.reason,content_revoked:true})};
      }
      case'relation.record':{
        inputObject(input,['release_id','name','from_id','to_id','relation_kind','provenance','completeness','evidence_ids'],['release_id','name','from_id','to_id','relation_kind','provenance','completeness']);
        const release=this.g(input.release_id,'release'),from=this.g(input.from_id),to=this.g(input.to_id);str(input.name,160);str(input.relation_kind,128);ensure(/^[a-z][a-z0-9_.-]{0,127}$/.test(input.relation_kind),'Invalid relation kind');
        ensure(this.productOf(from)===release.data.product_id&&this.productOf(to)===release.data.product_id,'Cross-product relation','PermissionDenied');choice(input.provenance,['declared','imported','heuristic','observed']);choice(input.completeness,['complete','partial','unknown']);
        if(input.provenance==='heuristic')ensure(input.completeness!=='complete','Heuristic relation cannot be complete');
        const evidenceIds=input.evidence_ids??[];array(evidenceIds,32);ensure(new Set(evidenceIds).size===evidenceIds.length,'Duplicate relation evidence');for(const id of evidenceIds){const evidence=this.g(id,'evidence');ensure(evidence.data.release_id===release.id,'Relation evidence/release mismatch');}
        if(input.provenance==='observed'){ensure(this.capabilities.canonical_graph_admission===true,'Observed relation needs Graph admission','PolicyDenied');ensure(evidenceIds.length>0,'Observed relation needs evidence');}
        return{entity:this.s.create('relation',{release_id:release.id,name:input.name,from_id:from.id,to_id:to.id,relation_kind:input.relation_kind,provenance:input.provenance,completeness:input.completeness,evidence_ids:evidenceIds,from_version:from.version,to_version:to.version,admission:input.provenance==='observed'?'canonical-owner-admitted':'local-explicit-record',created_at:iso()})};
      }
      case'impact.plan':{
        inputObject(input,['release_id','cause_ids','note'],['release_id','cause_ids']);const release=this.g(input.release_id,'release');array(input.cause_ids,64);ensure(new Set(input.cause_ids).size===input.cause_ids.length,'Duplicate impact causes');
        for(const id of input.cause_ids){const cause=this.g(id);ensure(this.productOf(cause)===release.data.product_id,'Cross-product impact cause','PermissionDenied');}
        if(input.note)lines(input.note,8000);
        const impact=this.impact(release.id),causes=[...input.cause_ids].sort();
        return{entity:this.s.create('impact_proposal',{release_id:release.id,name:'Impact proposal · '+release.data.name,cause_ids:causes,note:input.note??'',source_workspace_version:this.s.version(),impact,state:'PROPOSED',authority:'NONE',jobs_created:0,created_at:iso()})};
      }
      case'evidence.import':{
        inputObject(input,['release_id','target_id','source_id','name','build','classification','rights','description','origin_digest','job_id'],['release_id','target_id','source_id','name','build','classification','rights','description','origin_digest']);
        const release=this.g(input.release_id,'release'),target=this.g(input.target_id,'target'),source=this.g(input.source_id,'source');
        ensure(target.data.release_id===release.id&&source.data.product_id===release.data.product_id,'Evidence scope mismatch');
        choice(input.classification,CLASSES);choice(input.rights,RIGHTS);str(input.name,160);str(input.build,256);lines(input.description,8000);sha(input.origin_digest);
        if(input.job_id)str(input.job_id,96);
        return{entity:this.s.create('evidence',{...input,target_version:target.version,source_version:source.version,admission:'imported-declaration',technical:'UNKNOWN',host_acceptance:'NOT_ESTABLISHED',rights_basis:'operator-declaration',observed_at:iso()})};
      }
      case'deliverable.render':{
        inputObject(input,['id']);const d=this.g(input.id,'deliverable'),r=this.g(d.data.release_id,'release'),t=this.g(d.data.target_id,'target');
        const rendered=renderText(d,t,r);const hash=this.s.blob(rendered.bytes,rendered.mime);
        return{entity:this.s.create('artifact',{name:d.data.name,release_id:r.id,target_id:t.id,deliverable_id:d.id,sha256:hash,size_bytes:rendered.bytes.length,mime:rendered.mime,extension:rendered.extension,inputs:this.dependencies(d),classification:'editorial',producer:'launchwright-text/1',draft:true,technical:'UNKNOWN'})};
      }
      case'candidate.freeze':{
        inputObject(input,['release_id','name','artifact_ids','destination','contract','channel_profile_ids'],['release_id','name','artifact_ids','destination','contract']);const release=this.g(input.release_id,'release');str(input.name,160);str(input.destination,96);ensure(/^[a-z0-9][a-z0-9_-]{0,95}$/.test(input.destination),'Invalid local alias');
        array(input.artifact_ids,32);ensure(input.artifact_ids.length>0&&new Set(input.artifact_ids).size===input.artifact_ids.length,'Candidate artifacts invalid');
        object(input.contract,['version','required_reviewers','require_claims_verified','required_dimensions'],['version','required_reviewers','require_claims_verified']);str(input.contract.version,64);integer(input.contract.required_reviewers,1,8);ensure(typeof input.contract.require_claims_verified==='boolean','Claims policy required');
        const requiredDimensions=input.contract.required_dimensions??['editorial'];array(requiredDimensions,3);ensure(requiredDimensions.length>0&&new Set(requiredDimensions).size===requiredDimensions.length,'Review dimensions invalid');for(const d of requiredDimensions)choice(d,['technical','editorial','permissions']);
        const profileIds=input.channel_profile_ids??[];array(profileIds,16);ensure(new Set(profileIds).size===profileIds.length,'Duplicate channel profile');
        const profiles=profileIds.map(id=>this.g(id,'channel_profile'));for(const profile of profiles)ensure(profile.data.product_id===release.data.product_id,'Channel profile belongs to another product','PermissionDenied');
        const artifacts=input.artifact_ids.map(id=>this.g(id,'artifact'));const inputs=new Map();const claimIds=new Set();
        for(const a of artifacts){ensure(a.data.release_id===input.release_id,'Candidate artifact/release mismatch');ensure(this.freshness(a.data.inputs).length===0,'Artifact inputs changed','StaleReference');this.s.readBlob(a.data.sha256);for(const pin of a.data.inputs){inputs.set(pin.id,pin);if(pin.kind==='claim')claimIds.add(pin.id);}}
        for(const profile of profiles)inputs.set(profile.id,{id:profile.id,kind:profile.kind,version:profile.version});
        const contract={...input.contract,required_dimensions:requiredDimensions};
        const manifest={schema_version:'launchwright-candidate/1',release_id:input.release_id,artifact_ids:[...input.artifact_ids].sort(),artifacts:artifacts.map(a=>({id:a.id,sha256:a.data.sha256,bytes:a.data.size_bytes,extension:a.data.extension,mime:a.data.mime})).sort((a,b)=>a.id.localeCompare(b.id)),inputs:[...inputs.values()].sort((a,b)=>a.id.localeCompare(b.id)),claim_ids:[...claimIds].sort(),channel_profile_ids:[...profileIds].sort(),destination:input.destination,contract};
        const hash=digest('candidate',manifest);return{entity:this.s.create('candidate',{release_id:input.release_id,name:input.name,manifest,candidate_sha256:hash,frozen_at:iso(),publication_class:'private-draft-only'})};
      }
      case'candidate.export_bundle':{
        inputObject(input,['id','candidate_sha256']);const c=this.g(input.id,'candidate');sha(input.candidate_sha256);ensure(input.candidate_sha256===c.data.candidate_sha256,'Candidate digest mismatch','Conflict');
        const checked=this.inspectCandidate(c);ensure(checked.private_draft_allowed,'Candidate is stale or corrupt','StaleReference');
        const bundleManifest={schema_version:'launchwright-private-bundle/1',candidate_id:c.id,candidate_sha256:c.data.candidate_sha256,release_id:c.data.release_id,destination:c.data.manifest.destination,artifact_ids:c.data.manifest.artifact_ids,channel_profile_ids:c.data.manifest.channel_profile_ids??[],candidate_manifest:c.data.manifest};
        const entries=[{name:'manifest.json',bytes:Buffer.from(JSON.stringify(bundleManifest,null,2)+'\n')}];
        for(const id of c.data.manifest.artifact_ids){const a=this.g(id,'artifact'),blob=this.s.readBlob(a.data.sha256);entries.push({name:`artifacts/${a.id}.${a.data.extension}`,bytes:blob.bytes});}
        const bytes=createStoredZip(entries);ensure(bytes.length<=1024*1024,'Private bundle exceeds local artifact budget','ResourceExhausted');const hash=this.s.blob(bytes,'application/zip');
        return{entity:this.s.create('bundle',{release_id:c.data.release_id,name:c.data.name+' · private bundle',candidate_id:c.id,candidate_sha256:c.data.candidate_sha256,sha256:hash,size_bytes:bytes.length,mime:'application/zip',extension:'zip',artifact_ids:c.data.manifest.artifact_ids,channel_profile_ids:c.data.manifest.channel_profile_ids??[],state:'EXPORTED_NOT_DELIVERED',producer:'launchwright-bundle/1'})};
      }
      case'candidate.review':{
        inputObject(input,['id','candidate_sha256','decision','comment','dimension','waiver'],['id','candidate_sha256','decision','comment']);const c=this.g(input.id,'candidate');sha(input.candidate_sha256);ensure(c.data.candidate_sha256===input.candidate_sha256,'Candidate digest mismatch','Conflict');lines(input.comment,8000);
        const legacy=input.decision==='approve-editorial',dimension=input.dimension??(legacy?'editorial':null),decision=legacy?'approve':input.decision;choice(dimension,['technical','editorial','permissions']);choice(decision,['approve','request-changes','reject']);
        let waiver=null;if(input.waiver!==undefined){object(input.waiver,['reason','valid_until'],['reason']);lines(input.waiver.reason,4000);if(input.waiver.valid_until){str(input.waiver.valid_until,64);ensure(Number.isFinite(Date.parse(input.waiver.valid_until)),'Invalid waiver expiry');}ensure(decision!=='approve','An approval cannot also be a waiver');waiver={reason:input.waiver.reason,valid_until:input.waiver.valid_until??null};}
        ensure(this.freshness(c.data.manifest.inputs).length===0,'Candidate inputs changed','StaleReference');
        return{entity:this.s.create('review',{release_id:c.data.release_id,name:`${dimension} · ${decision} · ${this.principal}`,candidate_id:c.id,candidate_sha256:c.data.candidate_sha256,dimension,decision,comment:input.comment,decision_order:this.s.version().revision,reviewer:this.principal,authority:'local-review-only',waiver,technical_verification_unchanged:true})};
      }
      case'candidate.deliver_private':{
        inputObject(input,['id','candidate_sha256','alias_expected','acknowledge_draft']);const c=this.g(input.id,'candidate');ensure(input.candidate_sha256===c.data.candidate_sha256,'Candidate digest differs','Conflict');ensure(input.acknowledge_draft===true,'Draft acknowledgment required','ConsentRequired');
        const checked=this.inspectCandidate(c);ensure(checked.private_draft_allowed,'Candidate is stale or corrupt','StaleReference');
        ensure(checked.review_ready,'Required candidate review dimensions are not approved','PermissionDenied');
        ensure(!c.data.manifest.contract.require_claims_verified||!c.data.manifest.claim_ids.length,'Canonical claim verification unavailable','PolicyDenied');
        const name=c.data.manifest.destination;const row=this.s.db.prepare('SELECT * FROM aliases WHERE name=?').get(name);
        if(row){ensure(input.alias_expected&&sameVersion(input.alias_expected,{resource:`alias:${name}`,generation:row.generation,revision:row.revision}),'Private alias changed','StaleReference');}
        else ensure(input.alias_expected===null,'Alias state mismatch','StaleReference');
        const generation=row?.generation??randomUUID(),revision=row?(BigInt(row.revision)+1n).toString():'1';
        this.s.db.prepare('INSERT INTO aliases VALUES(?,?,?,?) ON CONFLICT(name) DO UPDATE SET revision=excluded.revision,candidate_id=excluded.candidate_id').run(name,generation,revision,c.id);
        return{entity:this.s.create('delivery',{release_id:c.data.release_id,name,candidate_id:c.id,candidate_sha256:c.data.candidate_sha256,state:'PRIVATE_DRAFT_RECORDED',external_state:'NOT_SENT',alias_version:{resource:`alias:${name}`,generation,revision},artifact_ids:c.data.manifest.artifact_ids,technical_state:checked.technical_state,delivered_by:this.principal})};
      }
      case'template.instantiate':{
        inputObject(input,['id','release_id','target_id','parameters','name']);const template=this.g(input.id,'template');object(input.parameters,template.data.parameters,template.data.parameters);for(const value of Object.values(input.parameters))str(value,4000);
        const d={release_id:input.release_id,target_id:input.target_id,name:str(input.name,160),format:template.data.format,content:template.data.content.replace(/\{\{([a-z][a-z0-9_]*)\}\}/g,(_,key)=>{ensure(Object.hasOwn(input.parameters,key),'Undeclared template parameter');return input.parameters[key];}),claim_ids:[],source_ids:[]};
        validateEntity('deliverable',d);this.assertReferences('deliverable',d);
        return{entity:this.s.create('deliverable',{...d,template_origin:{id:template.id,version:template.version,parameters_sha256:digest('template-parameters',input.parameters)}}),template_pin:template.version};
      }
      case'work.prepare':{
        inputObject(input,['release_id','name','action','arguments','budget','authorization'],['release_id','name','action','arguments','budget']);this.g(input.release_id,'release');str(input.name,160);choice(input.action,PLATFORM_ACTIONS);object(input.arguments);noSecrets(input.arguments);object(input.budget,['max_cost_microunits','currency','max_runtime_seconds'],['max_cost_microunits','currency','max_runtime_seconds']);integer(input.budget.max_cost_microunits,0,1000000000);str(input.budget.currency,8);integer(input.budget.max_runtime_seconds,1,3600);
        // This record is only an intent and budget proposal. Platform enforces actual execution authority and costs.
        if(PUBLICATION_ACTIONS.has(input.action)){this.allow('publish');ensure(input.authorization==='explicit-publication','Publication consent required','ConsentRequired');}
        return{entity:this.s.create('work',{...input,state:'PREPARED',authority:'platform-required',budget_enforced:false,platform_job_id:null,pending_digest:null})};
      }
      case'work.claim':{
        inputObject(input,['id','prepared_record']);const w=this.g(input.id,'work');ensure(w.data.state==='PREPARED','Work already claimed','Conflict');object(input.prepared_record);noSecrets(input.prepared_record);
        const pending=digest('pending',input.prepared_record);this.s.db.prepare('INSERT INTO pending VALUES(?,?,?)').run(w.id,JSON.stringify(input.prepared_record),'CLAIMED');
        return{entity:this.s.update(w.id,{...w.data,state:'CLAIMED',pending_digest:pending}),pending_digest:pending};
      }
      case'work.complete':{
        inputObject(input,['id','result','pending_digest']);const w=this.g(input.id,'work');ensure(['CLAIMED','OUTCOME_UNKNOWN'].includes(w.data.state),'Work not awaiting outcome','Conflict');ensure(w.data.pending_digest===input.pending_digest,'Pending binding mismatch','Conflict');object(input.result);
        const job=input.result.job_id??null;if(job)str(job,96);
        // Saved SDK response is a projection, not promotion into technical evidence or effect PASS.
        return{entity:this.s.update(w.id,{...w.data,state:'RESPONSE_RECORDED',platform_job_id:job,result:input.result,evidence_trust:'NOT_ADMITTED'})};
      }
      case'work.mark_unknown':{
        inputObject(input,['id']);const w=this.g(input.id,'work');ensure(['CLAIMED','OUTCOME_UNKNOWN'].includes(w.data.state),'Work not claimable as unknown','Conflict');return{entity:this.s.update(w.id,{...w.data,state:'OUTCOME_UNKNOWN'})};
      }
      case'workspace.rotate_epoch':{
        inputObject(input,['expected_epoch']);integer(input.expected_epoch,0,Number.MAX_SAFE_INTEGER-1);ensure(this.s.meta().epoch===input.expected_epoch,'Request epoch changed','Conflict');
        const next=input.expected_epoch+1;this.s.db.prepare('UPDATE meta SET epoch=? WHERE singleton=1').run(next);this.s.db.prepare('DELETE FROM receipts WHERE epoch<?').run(Math.max(0,next-1));return{request_epoch:next};
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
