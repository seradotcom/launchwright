// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import { NativeError, applicationContext, dispatchApplication, requireCondition as ensure, object, integer, requestIdentity, sameVersion, checkCancelled, validateValue } from '@semwright/native-sdk';
import { Store } from './store.mjs';
import { APP_VERSION, RESOURCE, KINDS, EDITABLE, RIGHTS, CLASSES, OPERATION_SCOPES, validateEntity, inputObject, idText, str, lines, array, choice, sha, digest, makeRequest, iso, noSecrets } from './contracts.mjs';
import { renderText } from './render.mjs';
import { validateCapture, validateVerification, validateWaiver, validateChannelPackage, validateChannelOutcome } from './records.mjs';
import { snapshotSummary } from './snapshot.mjs';
import { validateLocalization, assessLocalization } from './localization.mjs';
import { PROFILE_MATRIX, validateExtensionManifest, validateCompatibilityLock } from './extensions.mjs';
import { freezeCandidate, buildCandidateGates, inspectCandidateState, recordCandidateReview, assertPrivateDeliveryReady, assertChannelPinned, assertPartialDeliveryPolicy } from './candidate.mjs';
import { proposeChange, inspectChange, applyChange } from './change-proposal.mjs';
import { getHistory, listHistory, diffHistory } from './history.mjs';
export const PLATFORM_ACTIONS = ['recipes.prepare','recipes.execute','jobs.get','jobs.cancel','jobs.reconcile','evidence.get','artifacts.get','graph.observe','graph.observation','publish.preflight','publish.define','publish.version','publish.deploy','publish.invoke','publish.result'];
const PUBLICATION_ACTIONS = new Set(['publish.define','publish.version','publish.deploy','publish.invoke']);
const READ_ACTIONS = new Set(['jobs.get','evidence.get','artifacts.get','graph.observation','publish.result']);

export class LaunchwrightApplication {
  constructor(root, { initialize = false, readOnly = false, principal = 'local-owner', scopes = ['read','edit','capture','review','publish','admin'], capabilities = {} } = {}) {
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
    if(d.build_id)ref(d.build_id,'build');
    if(d.source_id)ref(d.source_id,'source');
    if(d.target_id)ref(d.target_id,'target');
    if(d.feature_id)ref(d.feature_id,'feature');
    if(d.availability_id)ref(d.availability_id,'availability');
    if(d.claim_id)ref(d.claim_id,'claim');
    if(d.deliverable_id)ref(d.deliverable_id,'deliverable');
    if(d.pinned_artifact_id){const a=ref(d.pinned_artifact_id,'artifact');ensure(a.data.deliverable_id===d.deliverable_id,'Pinned artifact belongs to another deliverable');}
    for(const [field,type]of [['claim_ids','claim'],['copy_block_ids','copy_block'],['source_ids','source'],['evidence_ids','evidence'],['required_claim_ids','claim'],['optional_claim_ids','claim'],['required_deliverable_ids','deliverable']])for(const id of d[field]??[])ref(id,type);
    if(kind==='availability'){
      ensure(this.get(d.feature_id,'feature').data.release_id===d.release_id,'Availability feature belongs to another release');
      ensure(this.get(d.target_id,'target').data.release_id===d.release_id,'Availability target belongs to another release');
    }
    if(kind==='anchor')ensure(this.get(d.target_id,'target').data.release_id===d.release_id,'Anchor target belongs to another release');
    if(kind==='claim'){
      for(const id of d.evidence_ids){const e=this.get(id,'evidence');ensure(e.data.target_id===d.target_id,'Evidence target does not match claim');}
      if(d.availability_id)ensure(this.get(d.availability_id,'availability').data.target_id===d.target_id,'Availability target does not match claim');
    }
    if(kind==='copy_block')ensure(this.get(d.claim_id,'claim').data.target_id===d.target_id,'CopyBlock target differs from its Claim target');
    if(kind==='deliverable'){
      for(const id of d.claim_ids)ensure(this.get(id,'claim').data.target_id===d.target_id,'Claim is for another target');
      for(const id of d.copy_block_ids??[])ensure(this.get(id,'copy_block').data.target_id===d.target_id,'CopyBlock is for another target');
    }
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
    capabilities:{editorial_text_exports:'available',durable_entity_history:this.store.hasHistory?'available':'migration-required',private_draft_delivery:'available',portable_snapshot_restore:'available-local-admin',declared_release_contracts:'available',localization_ledger:'available-layout-quality-not-inferred',extension_descriptors:'available-no-remote-code',compatibility_negotiation:'available',profile_preflight:'available-contract-only',state_anchors:'contract-and-assessment-only',impact_proposals:'available-no-execution-authority',document_change_proposals:'available-application-local-no-auto-merge',capture_receipts:'available-provenance-only',verification_ledger:'available-canonical-pass-requires-admission',waivers:'available-never-overwrite-verifier-state',channel_packages:'available-no-send',native_driver_host:'requires-owner-pinned-bundle-and-broker',platform:this.capabilities.platform??'not-connected',canonical_graph:'requires-platform-observation',browser_capture:'requires-canonical-driver-recipe',media_render:'requires-composition-recipe',mobile:'provenance-import-only',public_delivery:'requires-canonical-publish-receipt',...this.capabilities},
    limits:{page_items:128,reply_bytes:256*1024,artifact_bytes:1024*1024,receipt_epoch_items:20000},disclosure:'Local editorial checks are not Platform approvals or canonical effect verification.'};}
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
  extensionDiscovery(input){
    inputObject(input,['type','include_retired'],[]);if(input.type!==undefined)choice(input.type,['source_adapter','deliverable_renderer','channel_adapter','verifier_profile']);if(input.include_retired!==undefined)ensure(typeof input.include_retired==='boolean','include_retired must be boolean');
    const items=this.list('extension_package').filter(e=>(!input.type||e.data.type===input.type)&&(input.include_retired||e.data.status==='active')).map(e=>({id:e.id,version:e.version,name:e.data.name,type:e.data.type,package_version:e.data.package_version,schema_major:e.data.schema_major,digest:e.data.digest,license:e.data.license,permissions:e.data.permissions,inputs:e.data.inputs,outputs:e.data.outputs,preconditions:e.data.preconditions,evidence:e.data.evidence,limits:e.data.limits,status:e.data.status,admission:e.data.admission}));
    return{schema_version:'launchwright-extension-discovery/1',items,remote_code_execution:false,platform_registry_authority:false};
  }
  compatibilityNegotiate(input){
    inputObject(input,['schema_major','operations','kinds'],['schema_major']);integer(input.schema_major,1,32);
    const operations=input.operations??[],kinds=input.kinds??[];array(operations,128).forEach(v=>str(v,160));array(kinds,128).forEach(v=>str(v,160));
    const supportedOps=new Set(this.operations.keys()),supportedKinds=new Set(KINDS);
    return{schema_major:1,requested_schema_major:input.schema_major,compatible:input.schema_major===1,unsupported_operations:operations.filter(v=>!supportedOps.has(v)),unsupported_kinds:kinds.filter(v=>!supportedKinds.has(v)),supported_optional:{extensions:true,localization:true,channel_packages:true,portable_snapshots:true,durable_history:this.store.hasHistory},major_mismatch_behavior:'reject'};
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
      case'workspace.snapshot':inputObject(input,[]);return snapshotSummary(this);
      case'resource.get':inputObject(input,['id']);return this.get(input.id);
      case'events.list':{
        inputObject(input,['after','limit'],[]);const after=integer(input.after??0,0,Number.MAX_SAFE_INTEGER),limit=integer(input.limit??50,1,128);
        const rows=this.store.db.prepare('SELECT * FROM events WHERE seq>? ORDER BY seq LIMIT ?').all(after,limit+1);const more=rows.length>limit;
        const items=rows.slice(0,limit).map(e=>({...e,payload:JSON.parse(e.payload),schema_version:'launchwright-event/1'}));
        return{items,next_after:more?items.at(-1).seq:null,watermark:this.store.db.prepare('SELECT coalesce(max(seq),0) AS n FROM events').get().n,complete:!more};
      }
      case'history.get':return getHistory(this,input);
      case'history.list':return listHistory(this,input);
      case'history.diff':return diffHistory(this,input);
      case'release.coverage':inputObject(input,['release_id']);return this.coverage(input.release_id);
      case'release.impact':inputObject(input,['release_id']);return this.impact(input.release_id);
      case'anchor.assess':{
        inputObject(input,['id','observed_matches']);const anchor=this.get(input.id,'anchor');const observed=integer(input.observed_matches,0,1000);
        const expected=anchor.data.expected_count,state=observed===expected?'PASS':'FAIL';
        return{anchor_id:anchor.id,state,expected_count:expected,observed_matches:observed,unique:state==='PASS',selected:state==='PASS',reason:state==='PASS'?'unique-anchor':'anchor-cardinality-mismatch'};
      }
      case'candidate.inspect':inputObject(input,['id']);return this.inspectCandidate(this.get(input.id,'candidate'));
      case'verification.summary':inputObject(input,['candidate_id']);return this.verificationSummary(input.candidate_id);
      case'channel.status':inputObject(input,['release_id']);return this.channelStatus(input.release_id);
      case'localization.assess':inputObject(input,['id']);return assessLocalization(this,this.get(input.id,'localized_copy'));
      case'profile.matrix':inputObject(input,[]);return{profiles:PROFILE_MATRIX,execution_proof:false};
      case'profile.preflight':return this.profilePreflight(input);
      case'extension.discovery':return this.extensionDiscovery(input);
      case'compatibility.negotiate':return this.compatibilityNegotiate(input);
      case'compatibility.inspect':inputObject(input,['id']);return this.compatibilityInspect(input.id);
      case'change.inspect':inputObject(input,['id']);return inspectChange(this,input.id);
      case'artifact.read':{
        inputObject(input,['id']);const a=this.get(input.id,'artifact');const b=this.store.readBlob(a.data.sha256);
        ensure(b.bytes.length<=160000,'Use authenticated artifact download for this output','ResourceExhausted');return{artifact:a,text:b.bytes.toString('utf8')};
      }
      default:throw new NativeError('Unsupported','Unknown read operation');
    }
  }
  dependencies(deliverable){
    const d=deliverable.data;const entries=[deliverable,this.get(d.release_id,'release'),this.get(d.target_id,'target')];
    const addClaim=id=>{const c=this.get(id,'claim');entries.push(c);if(c.data.availability_id)entries.push(this.get(c.data.availability_id,'availability'));for(const eid of c.data.evidence_ids)entries.push(this.get(eid,'evidence'));};
    for(const id of d.source_ids)entries.push(this.get(id,'source'));
    for(const id of d.claim_ids)addClaim(id);
    for(const id of d.copy_block_ids??[]){const block=this.get(id,'copy_block');entries.push(block);addClaim(block.data.claim_id);}
    return[...new Map(entries.map(e=>[e.id,{id:e.id,kind:e.kind,version:e.version}])).values()].sort((a,b)=>a.id.localeCompare(b.id));
  }
  freshness(pins){const changed=[];for(const p of pins){let now;try{now=this.get(p.id);}catch{changed.push({id:p.id,reason:'missing'});continue;}if(!sameVersion(now.version,p.version))changed.push({id:p.id,reason:'revision-changed',expected:p.version,observed:now.version});}return changed;}
  claimCheck(claim){
    const c=claim.data;const release=this.get(c.release_id,'release');const target=this.get(c.target_id,'target');
    const evidence=c.evidence_ids.map(id=>this.get(id,'evidence'));
    const reasons=[];
    if(!evidence.length)reasons.push('no-evidence');
    for(const e of evidence){if(e.data.build!==release.data.build)reasons.push('build-mismatch');if(!sameVersion(e.data.target_version,target.version))reasons.push('target-revision-changed');if(!['owned','licensed'].includes(e.data.rights))reasons.push('rights-unresolved');if(e.data.technical!=='PASS')reasons.push('technical-verification-unknown');}
    if(c.valid_until&&Date.parse(c.valid_until)<=Date.now())reasons.push('claim-validity-expired');
    if(c.availability_id){
      const a=this.get(c.availability_id,'availability');
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
    this.get(releaseId,'release');const claimEntities=this.list('claim',releaseId),claims=claimEntities.map(c=>this.claimCheck(c));const byClaim=new Map(claims.map(c=>[c.claim_id,c]));const scenarios=this.list('scenario',releaseId);
    const contracts=this.list('release_contract',releaseId).map(contract=>{
      const obligations=[];
      for(const id of contract.data.required_claim_ids){const check=byClaim.get(id)??{status:'UNKNOWN',reasons:['claim-not-enumerated']};obligations.push({kind:'claim',id,state:check.status,reasons:check.reasons});}
      for(const id of contract.data.required_deliverable_ids){
        const artifacts=this.list('artifact',releaseId).filter(a=>a.data.deliverable_id===id);let state='UNKNOWN',reasons=['no-current-artifact'];
        for(const artifact of artifacts){const changed=this.freshness(artifact.data.inputs);if(changed.length)continue;try{this.store.readBlob(artifact.data.sha256);state='PASS';reasons=[];break;}catch{state='FAIL';reasons=['artifact-integrity-failed'];}}
        obligations.push({kind:'deliverable',id,state,reasons});
      }
      return{id:contract.id,name:contract.data.name,total:obligations.length,ready:obligations.filter(o=>o.state==='PASS').length,failed:obligations.filter(o=>o.state==='FAIL').length,unknown:obligations.filter(o=>o.state==='UNKNOWN').length,obligations,optional_claim_ids:contract.data.optional_claim_ids};
    });
    return{release_id:releaseId,claims,obligations:claims.length,pass:claims.filter(c=>c.status==='PASS').length,fail:claims.filter(c=>c.status==='FAIL').length,unknown:claims.filter(c=>c.status==='UNKNOWN').length,contracts,
      scenarios:scenarios.map(s=>({id:s.id,status:'UNKNOWN',reason:'canonical-execution-not-observed'})),inventory_scope:'registered-only',unknown_frontier:true,canonical_graph_authority:false};
  }
  impact(releaseId){
    this.get(releaseId,'release');const items=[];
    for(const a of this.list('artifact',releaseId)){const changed=this.freshness(a.data.inputs);if(changed.length)items.push({artifact_id:a.id,deliverable_id:a.data.deliverable_id,state:'INPUTS_CHANGED',changed});}
    const bindings=this.list('binding',releaseId).map(b=>({binding_id:b.id,mode:b.data.mode,action:b.data.mode==='rolling'?'revalidate-if-inputs-changed':'retain-pinned-history',pinned_artifact_id:b.data.pinned_artifact_id??null}));
    const contracts=this.coverage(releaseId).contracts;
    const contract_blockers=contracts.flatMap(c=>c.obligations.filter(o=>o.state!=='PASS').map(o=>({contract_id:c.id,...o})));
    const relations=this.list('relation',releaseId).map(r=>({id:r.id,from_id:r.data.from_id,to_id:r.data.to_id,kind:r.data.relation_kind,provenance:r.data.provenance,completeness:r.data.completeness,admission:r.data.admission}));
    return{release_id:releaseId,items,bindings,contract_blockers,relations,coverage:'DECLARED_DEPENDENCIES_ONLY',canonical_graph_authority:false,unknown_frontier:true,note:'This is an app input-revision comparison, explicit relation inventory and release-contract projection, not a Project Graph freshness verdict.'};
  }
  verificationSummary(candidateId){
    const candidate=this.get(candidateId,'candidate');
    const records=this.list('verification',candidate.data.release_id).filter(v=>v.data.candidate_id===candidate.id);
    const waivers=this.list('waiver',candidate.data.release_id).filter(w=>w.data.candidate_id===candidate.id);
    const checks=records.map(v=>{
      const related=waivers.filter(w=>w.data.verification_id===v.id);
      const active=related.filter(w=>!w.data.expires_at||Date.parse(w.data.expires_at)>Date.now());
      const admitted=v.data.admission==='canonical-owner-admitted';
      const effective=v.data.state==='FAIL'||v.data.state==='ERROR'?v.data.state:(admitted?v.data.state:'UNKNOWN');
      return{verification_id:v.id,dimension:v.data.dimension,reported_state:v.data.state,effective_state:effective,admission:v.data.admission,verifier:v.data.verifier,coverage:v.data.coverage,omissions:v.data.omissions,findings:v.data.findings,waivers:related.map(w=>({id:w.id,scope:w.data.scope,expires_at:w.data.expires_at??null,active:active.some(a=>a.id===w.id)})),waived:active.length>0};
    });
    const state=checks.some(c=>['FAIL','ERROR'].includes(c.effective_state))?'FAIL':checks.length&&checks.every(c=>c.effective_state==='PASS')?'PASS':'UNKNOWN';
    return{candidate_id:candidate.id,state,checks,canonical_passes:checks.filter(c=>c.effective_state==='PASS').length,failures:checks.filter(c=>['FAIL','ERROR'].includes(c.effective_state)).length,unknown:checks.filter(c=>c.effective_state==='UNKNOWN').length,note:'Waivers preserve the underlying verification state; non-canonical PASS reports remain UNKNOWN.'};
  }
  channelStatus(releaseId){
    this.get(releaseId,'release');
    const rows=this.list('channel_delivery',releaseId).sort((a,b)=>a.created.localeCompare(b.created));
    const latest=new Map();
    for(const row of rows)latest.set(row.data.profile_id+'\0'+row.data.participant,row);
    return{release_id:releaseId,deliveries:rows,latest:[...latest.values()],profiles:this.list('channel_profile').filter(p=>rows.some(r=>r.data.profile_id===p.id)).map(p=>({id:p.id,name:p.data.name,channel:p.data.channel,profile_version:p.data.profile_version,destination_class:p.data.destination_class,idempotency:p.data.idempotency})),external_send_performed:false};
  }
  candidateGates(candidate){return buildCandidateGates(this,candidate);}
  inspectCandidate(candidate){return inspectCandidateState(this,candidate);}
  mutate(operation,input){
    switch(operation){
      case'entity.create':{inputObject(input,['kind','data']);choice(input.kind,EDITABLE);const data=validateEntity(input.kind,input.data);this.assertReferences(input.kind,data);return{entity:this.store.create(input.kind,data)};}
      case'entity.update':{
        inputObject(input,['id','expected','data']);const e=this.get(input.id);ensure(EDITABLE.includes(e.kind),'Immutable resource cannot be edited','PermissionDenied');
        ensure(sameVersion(e.version,input.expected),'Entity revision changed','StaleReference');const data=validateEntity(e.kind,input.data);
        for(const parent of ['product_id','release_id'])ensure(e.data[parent]===data[parent],'Resource parent is immutable');this.assertReferences(e.kind,data);
        return{entity:this.store.update(e.id,e.data.template_origin?{...data,template_origin:e.data.template_origin}:data)};
      }
      case'change.propose':return proposeChange(this,input);
      case'change.apply':return applyChange(this,input);
      case'entity.retire':{
        inputObject(input,['id','expected','reason']);const e=this.get(input.id);ensure(EDITABLE.includes(e.kind),'Only editable domain resources can be retired','PermissionDenied');
        ensure(sameVersion(e.version,input.expected),'Entity revision changed','StaleReference');lines(input.reason,4000);
        if(['product','release'].includes(e.kind)){const children=this.store.all().filter(x=>x.kind!=='tombstone'&&(x.data.product_id===e.id||x.data.release_id===e.id));ensure(children.length===0,'Retire active children before their parent','Conflict');}
        return{entity:this.store.retire(e.id,{subject_id:e.id,original_kind:e.kind,retired_at:iso(),reason:input.reason,content_revoked:true})};
      }
      case'relation.record':{
        inputObject(input,['release_id','name','from_id','to_id','relation_kind','provenance','completeness','evidence_ids'],['release_id','name','from_id','to_id','relation_kind','provenance','completeness']);
        const release=this.get(input.release_id,'release'),from=this.get(input.from_id),to=this.get(input.to_id);str(input.name,160);str(input.relation_kind,128);ensure(/^[a-z][a-z0-9_.-]{0,127}$/.test(input.relation_kind),'Invalid relation kind');
        ensure(this.productOf(from)===release.data.product_id&&this.productOf(to)===release.data.product_id,'Relation crosses product boundary','PermissionDenied');choice(input.provenance,['declared','imported','heuristic','observed']);choice(input.completeness,['complete','partial','unknown']);
        if(input.provenance==='heuristic')ensure(input.completeness!=='complete','Heuristic relation cannot claim complete coverage');
        const evidenceIds=input.evidence_ids??[];array(evidenceIds,32);ensure(new Set(evidenceIds).size===evidenceIds.length,'Duplicate relation evidence');for(const id of evidenceIds){const evidence=this.get(id,'evidence');ensure(evidence.data.release_id===release.id,'Relation evidence belongs to another release');}
        if(input.provenance==='observed'){ensure(this.capabilities.canonical_graph_admission===true,'Observed relation requires canonical Graph admission','PolicyDenied');ensure(evidenceIds.length>0,'Observed relation requires admitted evidence');}
        return{entity:this.store.create('relation',{release_id:release.id,name:input.name,from_id:from.id,to_id:to.id,relation_kind:input.relation_kind,provenance:input.provenance,completeness:input.completeness,evidence_ids:evidenceIds,from_version:from.version,to_version:to.version,admission:input.provenance==='observed'?'canonical-owner-admitted':'local-explicit-record',created_at:iso()})};
      }
      case'impact.plan':{
        inputObject(input,['release_id','cause_ids','note'],['release_id','cause_ids']);const release=this.get(input.release_id,'release');array(input.cause_ids,64);ensure(new Set(input.cause_ids).size===input.cause_ids.length,'Duplicate impact causes');
        for(const id of input.cause_ids){const cause=this.get(id);ensure(this.productOf(cause)===release.data.product_id,'Impact cause belongs to another product','PermissionDenied');}
        if(input.note)lines(input.note,8000);
        const impact=this.impact(release.id),causes=[...input.cause_ids].sort();
        return{entity:this.store.create('impact_proposal',{release_id:release.id,name:'Impact proposal · '+release.data.name,cause_ids:causes,note:input.note??'',source_workspace_version:this.store.version(),impact,state:'PROPOSED',authority:'NONE',jobs_created:0,created_at:iso()})};
      }
      case'evidence.import':{
        inputObject(input,['release_id','target_id','source_id','name','build','classification','rights','description','origin_digest','job_id'],['release_id','target_id','source_id','name','build','classification','rights','description','origin_digest']);
        const release=this.get(input.release_id,'release'),target=this.get(input.target_id,'target'),source=this.get(input.source_id,'source');
        ensure(target.data.release_id===release.id&&source.data.product_id===release.data.product_id,'Evidence scope mismatch');
        choice(input.classification,CLASSES);choice(input.rights,RIGHTS);str(input.name,160);str(input.build,256);lines(input.description,8000);sha(input.origin_digest);
        if(input.job_id)str(input.job_id,96);
        return{entity:this.store.create('evidence',{...input,target_version:target.version,source_version:source.version,admission:'imported-declaration',technical:'UNKNOWN',host_acceptance:'NOT_ESTABLISHED',rights_basis:'operator-declaration',observed_at:iso()})};
      }
      case'capture.ingest':{
        const data=validateCapture(input);
        const release=this.get(data.release_id,'release'),target=this.get(data.target_id,'target'),source=this.get(data.source_id,'source'),scenario=this.get(data.scenario_id,'scenario');
        ensure(target.data.release_id===release.id&&scenario.data.release_id===release.id,'Capture target or scenario belongs to another release','PermissionDenied');
        ensure(source.data.product_id===release.data.product_id&&scenario.data.source_id===source.id&&scenario.data.target_id===target.id,'Capture source/scenario binding mismatch','PermissionDenied');
        ensure(source.data.approval==='approved','Capture source is not approved for execution','PermissionDenied');
        ensure(data.build===release.data.build,'Capture build differs from the release build','Conflict');
        if(data.receipt.build_observation!==undefined)ensure(data.receipt.build_observation===data.build,'Capture receipt observed another build','Conflict');
        const admission=data.receipt.authority==='imported'?'imported-declaration':'semwright-receipt-recorded';
        return{entity:this.store.create('evidence',{release_id:release.id,target_id:target.id,source_id:source.id,scenario_id:scenario.id,name:data.name,build:data.build,classification:data.classification,rights:data.rights,description:'Capture receipt for '+scenario.data.name,origin_digest:digest('capture-receipt',data.receipt),evidence_type:'capture',capture_state:data.receipt.outcome,receipt:data.receipt,observations:data.observations,segments:data.segments??[],target_version:target.version,source_version:source.version,scenario_version:scenario.version,admission,technical:'UNKNOWN',host_acceptance:'NOT_ESTABLISHED',rights_basis:'operator-declaration',started_at:data.started_at,finished_at:data.finished_at,observed_at:data.finished_at})};
      }
      case'verification.record':{
        const data=validateVerification(input),candidate=this.get(data.candidate_id,'candidate');
        const artifactSet=new Set(candidate.data.manifest.artifact_ids);
        for(const id of data.artifact_ids)ensure(artifactSet.has(id),'Verification references bytes outside the candidate','PermissionDenied');
        if(data.target_id){const target=this.get(data.target_id,'target');ensure(target.data.release_id===candidate.data.release_id,'Verification target belongs to another release','PermissionDenied');}
        if(data.verifier.authority==='canonical')ensure(this.capabilities.canonical_verifier_admission===true,'Canonical verifier admission is unavailable in this session','PolicyDenied');
        const admission=data.verifier.authority==='canonical'?'canonical-owner-admitted':data.verifier.authority==='heuristic'?'heuristic-report':'local-review-record';
        return{entity:this.store.create('verification',{release_id:candidate.data.release_id,name:data.dimension+' verification',...data,admission,recorded_by:this.principal,recorded_at:iso()})};
      }
      case'waiver.record':{
        const data=validateWaiver(input),candidate=this.get(data.candidate_id,'candidate'),verification=this.get(data.verification_id,'verification');
        ensure(verification.data.candidate_id===candidate.id&&verification.data.release_id===candidate.data.release_id,'Waiver verification belongs to another candidate','PermissionDenied');
        ensure(verification.data.state!=='PASS','A passing verification does not need a waiver','InvalidArgument');
        if(data.expires_at)ensure(Date.parse(data.expires_at)>Date.now(),'Waiver is already expired','InvalidArgument');
        return{entity:this.store.create('waiver',{release_id:candidate.data.release_id,name:'Waiver · '+verification.data.dimension,...data,author:this.principal,underlying_state:verification.data.state,created_at:iso(),changes_verification_state:false})};
      }
      case'deliverable.render':{
        inputObject(input,['id']);const d=this.get(input.id,'deliverable'),r=this.get(d.data.release_id,'release'),t=this.get(d.data.target_id,'target');
        const rendered=renderText(d,t,r);const hash=this.store.blob(rendered.bytes,rendered.mime);
        return{entity:this.store.create('artifact',{name:d.data.name,release_id:r.id,target_id:t.id,deliverable_id:d.id,sha256:hash,size_bytes:rendered.bytes.length,mime:rendered.mime,extension:rendered.extension,inputs:this.dependencies(d),classification:'editorial',producer:'launchwright-text/1',draft:true,technical:'UNKNOWN'})};
      }
      case'candidate.freeze':return freezeCandidate(this,input);
      case'candidate.review':return recordCandidateReview(this,input);
      case'candidate.deliver_private':{
        inputObject(input,['id','candidate_sha256','alias_expected','acknowledge_draft']);const c=this.get(input.id,'candidate');ensure(input.candidate_sha256===c.data.candidate_sha256,'Candidate digest differs','Conflict');ensure(input.acknowledge_draft===true,'Private delivery is a draft, not a verified launch','ConsentRequired');
        const checked=this.inspectCandidate(c);assertPrivateDeliveryReady(c,checked);
        const name=c.data.manifest.destination;const row=this.store.db.prepare('SELECT * FROM aliases WHERE name=?').get(name);
        if(row){ensure(input.alias_expected&&sameVersion(input.alias_expected,{resource:`alias:${name}`,generation:row.generation,revision:row.revision}),'Private alias changed','StaleReference');}
        else ensure(input.alias_expected===null,'Private alias did not exist','StaleReference');
        const generation=row?.generation??randomUUID(),revision=row?(BigInt(row.revision)+1n).toString():'1';
        this.store.db.prepare('INSERT INTO aliases VALUES(?,?,?,?) ON CONFLICT(name) DO UPDATE SET revision=excluded.revision,candidate_id=excluded.candidate_id').run(name,generation,revision,c.id);
        return{entity:this.store.create('delivery',{release_id:c.data.release_id,name,candidate_id:c.id,candidate_sha256:c.data.candidate_sha256,state:'PRIVATE_DRAFT_RECORDED',external_state:'NOT_SENT',alias_version:{resource:`alias:${name}`,generation,revision},artifact_ids:c.data.manifest.artifact_ids,technical_state:checked.technical_state,delivered_by:this.principal})};
      }
      case'channel.package':{
        const data=validateChannelPackage(input),candidate=this.get(data.candidate_id,'candidate'),profile=this.get(data.profile_id,'channel_profile'),release=this.get(candidate.data.release_id,'release');
        ensure(profile.data.product_id===release.data.product_id,'Channel profile belongs to another product','PermissionDenied');
        const checked=this.inspectCandidate(candidate);ensure(checked.private_draft_allowed,'Candidate has stale inputs or invalid bytes','StaleReference');
        if(candidate.data.manifest.schema_version==='launchwright-candidate/2'){assertChannelPinned(candidate,profile);assertPartialDeliveryPolicy(candidate,data.allow_partial);}
        if(!data.allow_partial)ensure(data.omissions.length===0,'Package omissions require explicit partial delivery approval','ConsentRequired');
        if(data.allow_partial)ensure(data.omissions.length>0,'Partial delivery must enumerate the omitted variants or obligations');
        const candidateManifestBytes=Buffer.from(JSON.stringify(candidate.data.manifest,null,2)+'\n'),candidateManifestSha=this.store.blob(candidateManifestBytes,'application/json');
        const manifest={schema_version:'launchwright-channel-package/2',candidate_id:candidate.id,candidate_sha256:candidate.data.candidate_sha256,candidate_manifest_sha256:candidateManifestSha,release_id:release.id,profile:{id:profile.id,version:profile.version,profile_version:profile.data.profile_version,channel:profile.data.channel,destination_class:profile.data.destination_class},participant:data.participant,locale:data.locale,partial:data.allow_partial,omissions:data.omissions,bundle_recipe:'private-zip-v1',artifacts:candidate.data.manifest.artifacts};
        const bytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n'),packageSha=this.store.blob(bytes,'application/json');
        return{entity:this.store.create('channel_delivery',{release_id:release.id,name:profile.data.channel+' · '+data.participant,profile_id:profile.id,profile_version:profile.version,candidate_id:candidate.id,candidate_sha256:candidate.data.candidate_sha256,candidate_manifest_sha256:candidateManifestSha,participant:data.participant,locale:data.locale,partial:data.allow_partial,omissions:data.omissions,package_sha256:packageSha,package_size_bytes:bytes.length,bundle_recipe:'private-zip-v1',state:'PACKAGE_READY',external_state:'NOT_SENT',root_delivery_id:null,parent_delivery_id:null,recovery_required:false,created_by:this.principal}),manifest};
      }
      case'channel.record_outcome':{
        const data=validateChannelOutcome(input),base=this.get(data.delivery_id,'channel_delivery'),profile=this.get(base.data.profile_id,'channel_profile');
        ensure(base.data.release_id&&base.data.candidate_id,'Channel delivery record is incomplete','Conflict');
        if(['UPLOADED','DRAFT_CREATED','ACTIVATED','PUBLISHED','RETIRED'].includes(data.state))ensure(!!data.receipt_digest,'External success state requires an exact receipt digest','InvalidArgument');
        if(['ACTIVATED','PUBLISHED','RETIRED'].includes(data.state))ensure(this.capabilities.canonical_publish_receipts===true,'Canonical publish receipt admission is unavailable in this session','PolicyDenied');
        const root=base.data.root_delivery_id??base.id;
        const recoveryRequired=data.state==='UNKNOWN'&&profile.data.idempotency!=='safe';
        return{entity:this.store.create('channel_delivery',{release_id:base.data.release_id,name:base.data.name,profile_id:base.data.profile_id,profile_version:base.data.profile_version,candidate_id:base.data.candidate_id,candidate_sha256:base.data.candidate_sha256,candidate_manifest_sha256:base.data.candidate_manifest_sha256??null,participant:base.data.participant,locale:base.data.locale,partial:base.data.partial,omissions:base.data.omissions,package_sha256:base.data.package_sha256,package_size_bytes:base.data.package_size_bytes,bundle_recipe:base.data.bundle_recipe??null,state:data.state,external_state:data.state,external_id:data.external_id??null,receipt_digest:data.receipt_digest??null,message:data.message??'',observed_at:data.observed_at,root_delivery_id:root,parent_delivery_id:base.id,recovery_required:recoveryRequired,retry_policy:recoveryRequired?'RECOVER_BEFORE_RETRY':profile.data.idempotency==='safe'?'IDEMPOTENT_RETRY_ALLOWED':'NO_AUTOMATIC_RETRY',recorded_by:this.principal})};
      }
      case'localization.create':{
        const data=validateLocalization(input),release=this.get(data.release_id,'release'),target=this.get(data.target_id,'target'),source=this.get(data.source_copy_block_id,'copy_block');
        ensure(target.data.release_id===release.id&&source.data.release_id===release.id,'Localization references another release','PermissionDenied');
        let glossary=null;if(data.glossary_id){glossary=this.get(data.glossary_id,'glossary');ensure(glossary.data.product_id===release.data.product_id,'Glossary belongs to another product','PermissionDenied');ensure(glossary.data.status==='active','Glossary is deprecated','Conflict');ensure(glossary.data.source_locale===source.data.locale&&glossary.data.target_locale===data.locale,'Glossary locale pair does not match localization','Conflict');}
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
      case'extension.register':{
        const data=validateExtensionManifest(input);ensure(data.schema_major===1,'Unsupported extension schema major','ProtocolMismatch');
        const duplicate=this.list('extension_package').find(e=>e.data.type===data.type&&e.data.name===data.name&&e.data.package_version===data.package_version&&e.data.status==='active');ensure(!duplicate,'This extension version is already registered','Conflict');
        return{entity:this.store.create('extension_package',{...data,status:'active',admission:'local-descriptor-only',remote_code_executable:false,registered_by:this.principal,registered_at:iso()})};
      }
      case'extension.retire':{
        inputObject(input,['id','expected','reason']);const ext=this.get(input.id,'extension_package');ensure(sameVersion(ext.version,input.expected),'Extension revision changed','StaleReference');ensure(ext.data.status==='active','Extension is already retired','Conflict');lines(input.reason,4000);
        return{entity:this.store.update(ext.id,{...ext.data,status:'retired',retired_by:this.principal,retired_at:iso(),retire_reason:input.reason,new_use_allowed:false})};
      }
      case'compatibility.lock':{
        const data=validateCompatibilityLock(input);const product=this.get(data.product_id,'product');
        const components=data.components.map(c=>{if(!c.resource_id)return{...c,resource_version:null};const r=this.get(c.resource_id);if(r.kind!=='extension_package')ensure(this.productOf(r)===product.id,'Compatibility component belongs to another product','PermissionDenied');if(r.kind==='extension_package')ensure(r.data.status==='active','Cannot lock a retired extension','Conflict');if(c.kind==='channel-profile')ensure(r.kind==='channel_profile','Compatibility component kind does not match resource');if(c.kind==='template')ensure(r.kind==='template','Compatibility component kind does not match resource');if(['source-adapter','renderer','channel-adapter','verifier'].includes(c.kind))ensure(r.kind==='extension_package','Compatibility component must reference an extension descriptor');return{...c,resource_version:r.version};});
        return{entity:this.store.create('compatibility_lock',{...data,components,product_version:product.version,created_by:this.principal,created_at:iso(),authority:'application-rehearsal-lock'})};
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
