// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import { NativeError, applicationContext, dispatchApplication, requireCondition as ensure, object, integer, requestIdentity, sameVersion, checkCancelled, validateValue } from '@semwright/native-sdk';
import { Store } from './store.mjs';
import { APP_VERSION, RESOURCE, KINDS, EDITABLE, RIGHTS, CLASSES, OPERATION_SCOPES, validateEntity, inputObject, idText, str, lines, array, choice, sha, digest, makeRequest, iso, noSecrets, locale } from './contracts.mjs';
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
    capabilities:{editorial_text_exports:'available',structured_documents:'available-local-proposal-workflow',localization:'available-human-reviewed-no-mt-authority',declarative_extension_registry:'available-contract-metadata-only',history:'available-explicit-migration',private_draft_delivery:'available',channel_attempt_journal:'available-no-browser-send',withdrawal_plans:'available-plan-only',declared_release_contracts:'available',state_anchors:'contract-and-assessment-only',impact_proposals:'available-no-execution-authority',native_driver_host:'requires-owner-pinned-bundle-and-broker',platform:this.capabilities.platform??'not-connected',canonical_graph:'requires-platform-observation',browser_capture:'requires-canonical-driver-recipe',media_render:'requires-composition-recipe',mobile:'provenance-import-only',public_delivery:'adapter-required',...this.capabilities},
    limits:{page_items:128,reply_bytes:256*1024,artifact_bytes:1024*1024,receipt_epoch_items:20000},disclosure:'Local checks are not canonical verification.'};}
  invoke(operation,args,context){
    const scope=OPERATION_SCOPES[operation];this.allow(scope);checkCancelled(context);
    if(scope==='read')return this.s.readSnapshot(()=>this.read(operation,args));
    object(args,['request','input'],['request','input']);const request=requestIdentity(args.request);
    ensure(request.resource===RESOURCE,'Wrong workspace');
    const prepared=makeRequest(operation,args.input,context.expected,request.epoch,request.key);
    ensure(prepared.request.request_sha256===request.request_sha256,'Request digest mismatch','Conflict');
    return this.s.transaction(operation,this.principal,request,context.expected,()=>{checkCancelled(context);return this.mutate(operation,args.input,context);});
  }
  read(operation,input){
    switch(operation){
      case'workspace.describe':inputObject(input,[]);return this.describe();
      case'workspace.doctor':{
        inputObject(input,[]);const pending=this.s.db.prepare("SELECT work_id,state FROM pending WHERE state NOT IN ('COMPLETED','RECONCILED') ORDER BY work_id LIMIT 65").all();
        return{schema_version:'launchwright-doctor/1',workspace_version:this.s.version(),domain_schema:this.s.meta().schema_version,history_ready:this.s.hasHistory,outstanding_intents:pending.slice(0,64),outstanding_truncated:pending.length>64,native_host_accepted:false,platform_connected:false,public_delivery:false,repairs_performed:false};
      }
      case'workspace.negotiate':{
        inputObject(input,['schema_version','operations'],['schema_version']);str(input.schema_version,64);const requested=input.operations??[];array(requested,128);requested.forEach(v=>str(v,128));
        const compatible=input.schema_version==='launchwright/1',supported=requested.filter(v=>Object.hasOwn(OPERATION_SCOPES,v)),unsupported=requested.filter(v=>!Object.hasOwn(OPERATION_SCOPES,v));
        return{status:compatible?'SUPPORTED':'UNSUPPORTED_MAJOR',compatible,server_schema_version:'launchwright/1',app_version:APP_VERSION,supported_operations:supported,unsupported_operations:unsupported,interpretation:'exact-no-coercion'};
      }
      case'resource.get':inputObject(input,['id']);return this.g(input.id);
      case'history.get':{
        inputObject(input,['id','revision','generation'],['id','revision']);idText(input.id);str(input.revision,64);ensure(/^\d+$/.test(input.revision),'Invalid revision');
        ensure(this.s.hasHistory,'History extension is not installed','ProtocolMismatch');const current=this.g(input.id),generation=input.generation??current.version.generation;if(input.generation)str(input.generation,128);
        const row=this.s.db.prepare('SELECT * FROM entity_history WHERE id=? AND generation=? AND revision=?').get(input.id,generation,input.revision);ensure(row,'Historical revision not found','NotFound');return this.s.decode(row);
      }
      case'history.list':{
        inputObject(input,['id','after_revision','limit'],['id']);idText(input.id);ensure(this.s.hasHistory,'History extension is not installed','ProtocolMismatch');const current=this.g(input.id),after=input.after_revision??'0';str(after,64);ensure(/^\d+$/.test(after),'Invalid historical cursor');const limit=integer(input.limit??32,1,64);
        const rows=this.s.db.prepare('SELECT * FROM entity_history WHERE id=? AND generation=? AND CAST(revision AS INTEGER)>CAST(? AS INTEGER) ORDER BY CAST(revision AS INTEGER) LIMIT ?').all(input.id,current.version.generation,after,limit+1);const more=rows.length>limit,items=rows.slice(0,limit).map(r=>this.s.decode(r));
        return{id:input.id,generation:current.version.generation,items,next_after:more?items.at(-1).version.revision:null,complete:!more,pre_migration_history:'NOT_RECONSTRUCTED'};
      }
      case'history.diff':{
        inputObject(input,['id','from_revision','to_revision']);idText(input.id);for(const k of ['from_revision','to_revision']){str(input[k],64);ensure(/^\d+$/.test(input[k]),'Invalid revision');}
        ensure(this.s.hasHistory,'History extension is not installed','ProtocolMismatch');const current=this.g(input.id),get=rev=>{const row=this.s.db.prepare('SELECT * FROM entity_history WHERE id=? AND generation=? AND revision=?').get(input.id,current.version.generation,rev);ensure(row,'Historical revision not found','NotFound');return this.s.decode(row);};const before=get(input.from_revision),after=get(input.to_revision),keys=[...new Set([...Object.keys(before.data),...Object.keys(after.data)])].sort(),changed=keys.filter(k=>JSON.stringify(before.data[k])!==JSON.stringify(after.data[k]));
        return{id:input.id,from:before.version,to:after.version,kind_before:before.kind,kind_after:after.kind,changed_fields:changed,before:before.data,after:after.data};
      }
      case'events.list':{
        inputObject(input,['after','limit'],[]);const after=integer(input.after??0,0,Number.MAX_SAFE_INTEGER),limit=integer(input.limit??50,1,128);
        const rows=this.s.db.prepare('SELECT * FROM events WHERE seq>? ORDER BY seq LIMIT ?').all(after,limit+1);const more=rows.length>limit;
        const items=rows.slice(0,limit).map(e=>({...e,payload:JSON.parse(e.payload),schema_version:'launchwright-event/1'}));
        return{items,next_after:more?items.at(-1).seq:null,watermark:this.s.db.prepare('SELECT coalesce(max(seq),0) AS n FROM events').get().n,complete:!more};
      }
      case'release.coverage':inputObject(input,['release_id']);return this.coverage(input.release_id);
      case'release.impact':inputObject(input,['release_id']);return this.impact(input.release_id);
      case'release.channels':inputObject(input,['release_id']);return this.releaseChannels(input.release_id);
      case'channel.inspect':inputObject(input,['id']);return this.inspectChannelAttempt(this.g(input.id,'channel_attempt'));
      case'anchor.assess':{
        inputObject(input,['id','observed_matches']);const anchor=this.g(input.id,'anchor');const observed=integer(input.observed_matches,0,1000);
        const expected=anchor.data.expected_count,state=observed===expected?'PASS':'FAIL';
        return{anchor_id:anchor.id,state,expected_count:expected,observed_matches:observed,unique:state==='PASS',selected:state==='PASS',reason:state==='PASS'?'unique-anchor':'anchor-cardinality-mismatch'};
      }
      case'candidate.inspect':inputObject(input,['id']);return this.inspectCandidate(this.g(input.id,'candidate'));
      case'document.inspect':{
        inputObject(input,['id']);const document=this.g(input.id,'document'),proposals=this.l('proposal',document.data.release_id).filter(p=>p.data.document_id===document.id);
        return{document,proposals,open_proposals:proposals.filter(p=>p.data.state==='OPEN').map(p=>({...p,stale:!sameVersion(p.data.document_version,document.version)})),renderers:['markdown','html'],pdf_renderer:'EXTERNAL_REQUIRED',automatic_human_overwrite:false};
      }
      case'translation.inspect':inputObject(input,['id']);return this.inspectTranslation(this.g(input.id,'translation'));
      case'extension.describe':inputObject(input,['id']);return this.describeExtension(this.g(input.id,'extension_contract'));
      case'extension.negotiate':{
        inputObject(input,['id','contract_version','app_schema_version']);const e=this.g(input.id,'extension_contract');str(input.contract_version,64);str(input.app_schema_version,64);const requestedMajor=this.contractMajor(input.contract_version),providedMajor=this.contractMajor(e.data.contract_version),appOk=e.data.compatibility.app_schema_versions.includes(input.app_schema_version),active=e.data.state==='ACTIVE';
        return{extension_id:e.id,status:active&&requestedMajor===providedMajor&&appOk?'SUPPORTED':!active?'RETIRED':'UNSUPPORTED',active,major_compatible:requestedMajor===providedMajor,app_schema_compatible:appOk,contract_version:e.data.contract_version,generic_view:true,remote_code_loaded:false};
      }
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
    if(d.document_origin?.id)entries.push(this.g(d.document_origin.id,'document'));
    if(d.translation_origin?.id){const translation=this.g(d.translation_origin.id,'translation');entries.push(translation);for(const id of [translation.data.source_id,translation.data.glossary_id,translation.data.font_profile_id])entries.push(this.g(id));}
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
    return{candidate,gates,reviews,review_dimensions,required_review_dimensions:required,review_ready,fresh,external_publication_allowed:false,private_draft_allowed:fresh&&!gates.some(g=>g.name==='artifact-bytes'&&g.state==='FAIL'),technical_state:gates.some(g=>g.state==='FAIL')?'FAIL':'UNKNOWN'};
  }
  channelCompatibility(candidate,profile){
    const issues=[],checked=this.inspectCandidate(candidate);
    if(profile.kind!=='channel_profile')issues.push({reason:'channel-profile-retired-or-missing'});
    const pin=candidate.data.manifest.inputs.find(p=>p.id===profile.id);
    if(!candidate.data.manifest.channel_profile_ids?.includes(profile.id)||!pin)issues.push({reason:'profile-not-frozen-in-candidate'});
    else if(!sameVersion(pin.version,profile.version))issues.push({reason:'channel-profile-revision-changed',expected:pin.version,observed:profile.version});
    if(!checked.fresh)issues.push({reason:'candidate-inputs-changed'});
    if(!checked.review_ready)issues.push({reason:'required-review-dimensions-pending'});
    if(candidate.data.manifest.contract.require_claims_verified&&candidate.data.manifest.claim_ids.length)issues.push({reason:'canonical-claim-verification-unavailable'});
    const artifacts=[];
    if(profile.kind==='channel_profile')for(const id of candidate.data.manifest.artifact_ids){
      const artifact=this.g(id,'artifact'),deliverable=this.g(artifact.data.deliverable_id,'deliverable');
      const row={artifact_id:id,format:deliverable.data.format,size_bytes:artifact.data.size_bytes,format_allowed:profile.data.formats.includes(deliverable.data.format),size_allowed:artifact.data.size_bytes<=profile.data.max_artifact_bytes};
      artifacts.push(row);
      if(!row.format_allowed)issues.push({reason:'artifact-format-not-allowed',...row});
      if(!row.size_allowed)issues.push({reason:'artifact-exceeds-channel-limit',...row});
    }
    return{ready:issues.length===0,issues,artifacts,candidate_fresh:checked.fresh,review_ready:checked.review_ready};
  }
  inspectChannelAttempt(attempt){
    const candidate=this.g(attempt.data.candidate_id,'candidate'),profile=this.g(attempt.data.channel_profile_id);
    const candidate_current=sameVersion(candidate.version,attempt.data.candidate_version),profile_current=profile.kind==='channel_profile'&&sameVersion(profile.version,attempt.data.channel_profile_version);
    const compatibility=profile.kind==='channel_profile'?this.channelCompatibility(candidate,profile):{ready:false,issues:[{reason:'channel-profile-retired-or-missing'}],artifacts:[],candidate_fresh:true,review_ready:false};
    const pending=this.s.db.prepare('SELECT state,record FROM pending WHERE work_id=?').get(attempt.id);
    const pending_digest=pending?digest('channel-pending',JSON.parse(pending.record)):null;
    return{attempt,candidate_version_current:candidate_current,channel_profile_version_current:profile_current,compatibility,pending:{present:!!pending,state:pending?.state??null,digest_matches:pending?pending_digest===attempt.data.pending_digest:null},reconcile_required:['SENT','PROCESSING','UNKNOWN'].includes(attempt.data.state),automatic_resend_allowed:false,retry_allowed:attempt.data.retry_allowed===true};
  }
  releaseChannels(releaseId){
    this.g(releaseId,'release');const attempts=this.l('channel_attempt',releaseId),withdrawals=this.l('withdrawal',releaseId),state_counts={};
    for(const attempt of attempts)state_counts[attempt.data.state]=(state_counts[attempt.data.state]??0)+1;
    return{release_id:releaseId,attempts,withdrawals,state_counts,atomic_across_channels:false,participant_states_independent:true,note:'A channel participant may fail or remain UNKNOWN without rolling back another participant.'};
  }
  contractMajor(version){str(version,64);const m=/^(\d+)\.(\d+)\.(\d+)(?:[-+][A-Za-z0-9.-]+)?$/.exec(version);ensure(m,'Expected semantic contract version');return Number(m[1]);}
  documentData(raw){
    inputObject(raw,['release_id','name','target_id','locale','branch_mode','format','sections','external_base'],['release_id','name','target_id','locale','branch_mode','format','sections']);const release=this.g(raw.release_id,'release'),target=this.g(raw.target_id,'target');ensure(target.data.release_id===release.id,'Document target/release mismatch');str(raw.name,160);locale(raw.locale);choice(raw.branch_mode,['rolling','pinned','lts']);choice(raw.format,['markdown','html']);array(raw.sections,64);ensure(raw.sections.length>0,'Document requires a section');
    const sectionIds=new Set(),blockIds=new Set(),sections=raw.sections.map(section=>{object(section,['id','title','owner','blocks'],['id','title','owner','blocks']);str(section.id,64);ensure(/^[a-z][a-z0-9_-]{0,63}$/.test(section.id),'Invalid section ID');ensure(!sectionIds.has(section.id),'Duplicate section ID');sectionIds.add(section.id);str(section.title,240);choice(section.owner,['human','managed','imported']);array(section.blocks,128);return{...section,blocks:section.blocks.map(block=>{object(block,['id','kind','owner','content','claim_ids','source_ids','scenario_id','evidence_id','language'],['id','kind','owner','content']);str(block.id,64);ensure(/^[a-z][a-z0-9_-]{0,63}$/.test(block.id),'Invalid block ID');ensure(!blockIds.has(block.id),'Duplicate block ID');blockIds.add(block.id);choice(block.kind,['paragraph','heading','code','instruction']);choice(block.owner,['human','managed','imported']);lines(block.content,12000);if(block.language)str(block.language,64);const claim_ids=block.claim_ids??[],source_ids=block.source_ids??[];array(claim_ids,32);array(source_ids,32);for(const id of claim_ids){const e=this.g(id,'claim');ensure(e.data.release_id===release.id,'Document claim/release mismatch');}for(const id of source_ids){const e=this.g(id,'source');ensure(e.data.product_id===release.data.product_id,'Document source/product mismatch');}if(block.scenario_id){const e=this.g(block.scenario_id,'scenario');ensure(e.data.release_id===release.id,'Document scenario/release mismatch');}if(block.evidence_id){const e=this.g(block.evidence_id,'evidence');ensure(e.data.release_id===release.id,'Document evidence/release mismatch');}return{...block,claim_ids,source_ids};})};});
    let external_base=null;if(raw.external_base){object(raw.external_base,['system','locator','revision'],['system','locator','revision']);choice(raw.external_base.system,['git','docs-repo']);str(raw.external_base.locator,1024);str(raw.external_base.revision,256);external_base={...raw.external_base};}
    return{release_id:release.id,name:raw.name,target_id:target.id,locale:raw.locale,branch_mode:raw.branch_mode,format:raw.format,sections,external_base,created_by:this.principal,code_execution:'NEVER_ON_IMPORT'};
  }
  documentBlock(document,blockId){for(let si=0;si<document.data.sections.length;si++){const section=document.data.sections[si];for(let bi=0;bi<section.blocks.length;bi++)if(section.blocks[bi].id===blockId)return{section,block:section.blocks[bi],si,bi};}throw new NativeError('NotFound','Document block not found');}
  documentContent(document){return document.data.sections.map(section=>'## '+section.title+'\n\n'+section.blocks.map(block=>block.kind==='code'?block.content.split('\n').map(line=>'    '+line).join('\n'):block.kind==='heading'?'### '+block.content:block.content).join('\n\n')).join('\n\n');}
  documentRefs(document){const claims=new Set(),sources=new Set();for(const section of document.data.sections)for(const block of section.blocks){for(const id of block.claim_ids??[])claims.add(id);for(const id of block.source_ids??[])sources.add(id);}return{claim_ids:[...claims].sort(),source_ids:[...sources].sort()};}
  sourceText(entity){if(entity.kind==='copy_block')return{locale:entity.data.locale,text:entity.data.content,claim_ids:[entity.data.claim_id],source_ids:[]};if(entity.kind==='deliverable'){const t=this.g(entity.data.target_id,'target');return{locale:t.data.editorial_locale,text:entity.data.content,claim_ids:entity.data.claim_ids,source_ids:entity.data.source_ids};}if(entity.kind==='document'){const refs=this.documentRefs(entity);return{locale:entity.data.locale,text:this.documentContent(entity),...refs};}throw new NativeError('InvalidArgument','Translation source must be copy_block, deliverable, or document');}
  translationRisk(source,target){const tokens=s=>[...new Set((s.match(/(?:[$€£¥]|\b(?:USD|EUR|MXN|GBP|JPY)\b|\b\d+(?:[.,]\d+)?(?:%|kg|g|km|m|cm|ms|s|h)?\b)/gi)??[]))].sort();const source_tokens=tokens(source),target_tokens=tokens(target),missing=source_tokens.filter(v=>!target_tokens.includes(v));const negation_present=/\b(?:no|not|never|without|cannot|can't|nunca|sin)\b/i.test(source);return{lexical_only:true,protected_tokens:source_tokens,missing_tokens:missing,negation_present,requires_human_semantic_review:negation_present||missing.length>0,automatic_semantic_pass:false};}
  inspectTranslation(entity){
    const changed=[],blocked=[];for(const pin of [{id:entity.data.source_id,version:entity.data.source_version,label:'source'},{id:entity.data.target_id,version:entity.data.target_version,label:'target'},{id:entity.data.glossary_id,version:entity.data.glossary_version,label:'glossary'},{id:entity.data.font_profile_id,version:entity.data.font_profile_version,label:'font_profile'}]){let now;try{now=this.g(pin.id);}catch{blocked.push({ref:pin.label,id:pin.id,reason:'missing'});continue;}if(now.kind==='tombstone')blocked.push({ref:pin.label,id:pin.id,reason:'retired'});else if(!pin.version||!sameVersion(now.version,pin.version))changed.push({ref:pin.label,id:pin.id,expected:pin.version??null,observed:now.version});}
    let sourceInfo=null,risk={lexical_only:true,protected_tokens:[],missing_tokens:[],negation_present:false,requires_human_semantic_review:true,automatic_semantic_pass:false,unavailable:true};
    if(!blocked.some(v=>v.ref==='source')){const source=this.g(entity.data.source_id);sourceInfo=this.sourceText(source);risk=this.translationRisk(sourceInfo.text,entity.data.text);}
    const computed_state=blocked.length?'BLOCKED':changed.length?'STALE_SOURCE':entity.data.state;
    return{translation:entity,computed_state,changed,blocked,risk,reviewable:!blocked.length&&!changed.length,automatic_fallback:false,semantic_verification:entity.data.semantic_verification};
  }
  containsRef(value,id){if(value===id)return true;if(Array.isArray(value))return value.some(v=>this.containsRef(v,id));if(value&&typeof value==='object')return Object.values(value).some(v=>this.containsRef(v,id));return false;}
  describeExtension(e){return{extension:e,generic_view:{name:e.data.name,type:e.data.type,contract_version:e.data.contract_version,state:e.data.state,summary:e.data.descriptor.summary,properties:e.data.descriptor.properties,actions:e.data.descriptor.actions},code_execution:'NOT_FROM_DESCRIPTOR',package_bytes_embedded:false,permissions:e.data.permissions,toolchain_lock:e.data.toolchain_lock};}
  validateExtension(raw){
    inputObject(raw,['name','type','contract_version','package','permissions','inputs','outputs','transformation','preconditions','evidence','compatibility','limits','descriptor']);str(raw.name,160);choice(raw.type,['source','renderer','channel','verifier']);this.contractMajor(raw.contract_version);object(raw.package,['name','version','sha256','license','source'],['name','version','sha256','license','source']);str(raw.package.name,160);str(raw.package.version,64);sha(raw.package.sha256);str(raw.package.license,96);str(raw.package.source,1024);array(raw.permissions,16);for(const p of raw.permissions)choice(p,['read-source','read-artifacts','write-draft','channel-effect','verify']);ensure(new Set(raw.permissions).size===raw.permissions.length,'Duplicate extension permission');for(const key of ['inputs','outputs','preconditions','evidence']){array(raw[key],64);raw[key].forEach(v=>str(v,256));}str(raw.transformation,2000);object(raw.compatibility,['app_schema_versions','notes'],['app_schema_versions']);array(raw.compatibility.app_schema_versions,16);raw.compatibility.app_schema_versions.forEach(v=>str(v,64));if(raw.compatibility.notes)lines(raw.compatibility.notes,2000);object(raw.limits,['max_input_bytes','max_output_bytes','timeout_seconds'],['max_input_bytes','max_output_bytes','timeout_seconds']);integer(raw.limits.max_input_bytes,1,64*1024*1024);integer(raw.limits.max_output_bytes,1,64*1024*1024);integer(raw.limits.timeout_seconds,1,3600);object(raw.descriptor,['summary','properties','actions'],['summary','properties','actions']);lines(raw.descriptor.summary,2000);array(raw.descriptor.properties,64);array(raw.descriptor.actions,32);for(const prop of raw.descriptor.properties){object(prop,['name','type','unit','required'],['name','type']);str(prop.name,96);choice(prop.type,['string','integer','boolean','enum','digest','uri','version']);if(prop.unit)str(prop.unit,64);if(prop.required!==undefined)ensure(typeof prop.required==='boolean','Descriptor required must be boolean');}for(const action of raw.descriptor.actions){str(action,96);ensure(/^[a-z][a-z0-9_.-]{0,95}$/.test(action),'Invalid extension action');}noSecrets(raw);const encoded=JSON.stringify(raw);ensure(!/<(?:script|iframe|object|embed)\b|javascript:|data:text\/html/i.test(encoded),'Executable descriptor content rejected');return structuredClone(raw);
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
      case'channel.prepare':{
        inputObject(input,['candidate_id','candidate_sha256','channel_profile_id','logical_key','authorization','retry_of'],['candidate_id','candidate_sha256','channel_profile_id','logical_key','authorization']);
        const candidate=this.g(input.candidate_id,'candidate'),profile=this.g(input.channel_profile_id,'channel_profile');sha(input.candidate_sha256);ensure(candidate.data.candidate_sha256===input.candidate_sha256,'Candidate digest mismatch','Conflict');
        str(input.logical_key,128);ensure(/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(input.logical_key),'Invalid logical channel request key');ensure(profile.data.delivery_mode!=='export','Export-only profiles use candidate.export_bundle and never create a delivery attempt','InvalidArgument');
        ensure(input.authorization==='explicit-channel-delivery','Explicit channel delivery authorization required','ConsentRequired');
        const compatibility=this.channelCompatibility(candidate,profile);ensure(compatibility.ready,'Candidate is not ready for this ChannelProfile','PolicyDenied');
        const duplicates=this.l('channel_attempt',candidate.data.release_id).filter(a=>a.data.channel_profile_id===profile.id&&a.data.logical_key===input.logical_key);
        let retry=null,attempt_no=1;
        if(input.retry_of){
          retry=this.g(input.retry_of,'channel_attempt');ensure(retry.data.channel_profile_id===profile.id&&retry.data.candidate_id===candidate.id&&retry.data.logical_key===input.logical_key,'Retry binding differs from original attempt','Conflict');
          ensure(retry.data.state==='FAILED'&&retry.data.reconciliation_outcome==='NOT_FOUND'&&retry.data.retry_allowed===true,'Retry is not authorized by a conclusive reconciliation','PolicyDenied');
          const latest=duplicates.sort((a,b)=>a.data.attempt_no-b.data.attempt_no).at(-1);ensure(latest?.id===retry.id,'Retry must continue the latest reconciled attempt','Conflict');attempt_no=retry.data.attempt_no+1;
        }else ensure(duplicates.length===0,'Logical channel request already exists; inspect/reconcile instead of resending','Conflict');
        return{entity:this.s.create('channel_attempt',{release_id:candidate.data.release_id,name:`${profile.data.name} · ${input.logical_key}`,candidate_id:candidate.id,candidate_sha256:candidate.data.candidate_sha256,candidate_version:candidate.version,channel_profile_id:profile.id,channel_profile_version:profile.version,channel_profile_label:profile.data.profile_version,channel_policy:{channel:profile.data.channel,delivery_mode:profile.data.delivery_mode,idempotency:profile.data.idempotency,withdrawal:profile.data.withdrawal,formats:profile.data.formats,locales:profile.data.locales,max_artifact_bytes:profile.data.max_artifact_bytes},logical_key:input.logical_key,attempt_no,retry_of:retry?.id??null,state:'PREPARED',dispatch_state:'NOT_CLAIMED',external_state:'NOT_SENT',artifact_ids:candidate.data.manifest.artifact_ids,pending_digest:null,external_id:null,observation:null,reconciliation_outcome:null,retry_allowed:false,resent:false,prepared_by:this.principal,prepared_at:iso(),authorization:'explicit-channel-delivery',platform_cost_ledger:'external'})};
      }
      case'channel.claim':{
        inputObject(input,['id','prepared_record','acknowledge_external_effect']);const attempt=this.g(input.id,'channel_attempt');ensure(attempt.data.state==='PREPARED'&&attempt.data.dispatch_state==='NOT_CLAIMED','Channel attempt already claimed','Conflict');ensure(input.acknowledge_external_effect===true,'External effect acknowledgment required','ConsentRequired');
        const candidate=this.g(attempt.data.candidate_id,'candidate'),profile=this.g(attempt.data.channel_profile_id,'channel_profile');ensure(sameVersion(candidate.version,attempt.data.candidate_version)&&sameVersion(profile.version,attempt.data.channel_profile_version),'Pinned candidate or ChannelProfile changed','StaleReference');
        ensure(this.channelCompatibility(candidate,profile).ready,'Channel attempt is no longer admissible','PolicyDenied');object(input.prepared_record);noSecrets(input.prepared_record);
        ensure(!this.s.db.prepare('SELECT 1 FROM pending WHERE work_id=?').get(attempt.id),'Pending channel request already exists','Conflict');
        const pending=digest('channel-pending',input.prepared_record);this.s.db.prepare('INSERT INTO pending VALUES(?,?,?)').run(attempt.id,JSON.stringify(input.prepared_record),'CLAIMED');
        return{entity:this.s.update(attempt.id,{...attempt.data,dispatch_state:'CLAIMED',pending_digest:pending,claimed_by:this.principal,claimed_at:iso()}),pending_digest:pending,send_once:true};
      }
      case'channel.mark_unknown':{
        inputObject(input,['id','pending_digest']);const attempt=this.g(input.id,'channel_attempt');sha(input.pending_digest);ensure(attempt.data.pending_digest===input.pending_digest,'Pending channel request binding mismatch','Conflict');ensure(attempt.data.dispatch_state==='CLAIMED'||attempt.data.state==='UNKNOWN','Channel attempt is not awaiting an outcome','Conflict');
        const pending=this.s.db.prepare('SELECT state FROM pending WHERE work_id=?').get(attempt.id);ensure(pending,'Durable pending channel request is missing','NotFound');this.s.db.prepare('UPDATE pending SET state=? WHERE work_id=?').run('OUTCOME_UNKNOWN',attempt.id);
        return{entity:this.s.update(attempt.id,{...attempt.data,state:'UNKNOWN',dispatch_state:'OUTCOME_UNKNOWN',external_state:'UNKNOWN',last_transition_at:iso(),resent:false,retry_allowed:false}),resent:false,reconcile_required:true};
      }
      case'channel.complete':{
        inputObject(input,['id','pending_digest','outcome']);const attempt=this.g(input.id,'channel_attempt');sha(input.pending_digest);ensure(attempt.data.pending_digest===input.pending_digest,'Pending channel request binding mismatch','Conflict');ensure(attempt.data.dispatch_state==='CLAIMED'||attempt.data.state==='UNKNOWN','Channel attempt is not awaiting completion','Conflict');ensure(this.s.db.prepare('SELECT 1 FROM pending WHERE work_id=?').get(attempt.id),'Durable pending channel request is missing','NotFound');
        object(input.outcome,['transport','provider_state','external_id','observation'],['transport','provider_state']);noSecrets(input.outcome);choice(input.outcome.transport,['accepted','rejected']);choice(input.outcome.provider_state,['sent','processing','published','failed','unknown']);
        if(input.outcome.external_id)str(input.outcome.external_id,256);
        let observation=null;if(input.outcome.observation){object(input.outcome.observation,['source','fingerprint','inspected_at'],['source','fingerprint','inspected_at']);str(input.outcome.observation.source,128);ensure(/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(input.outcome.observation.source),'Invalid observation source');str(input.outcome.observation.fingerprint,512);str(input.outcome.observation.inspected_at,64);ensure(Number.isFinite(Date.parse(input.outcome.observation.inspected_at)),'Invalid observation time');observation={...input.outcome.observation};}
        if(input.outcome.provider_state==='published')ensure(observation,'Published state requires independent destination observation','PolicyDenied');
        const state=input.outcome.transport==='rejected'||input.outcome.provider_state==='failed'?'FAILED':input.outcome.provider_state==='published'?'OBSERVED_PUBLISHED':input.outcome.provider_state==='processing'?'PROCESSING':input.outcome.provider_state==='unknown'?'UNKNOWN':'SENT';
        this.s.db.prepare('UPDATE pending SET state=? WHERE work_id=?').run(state==='UNKNOWN'?'OUTCOME_UNKNOWN':'COMPLETED',attempt.id);
        return{entity:this.s.update(attempt.id,{...attempt.data,state,dispatch_state:state==='UNKNOWN'?'OUTCOME_UNKNOWN':'RESPONSE_RECORDED',external_state:state,transport:input.outcome.transport,provider_state:input.outcome.provider_state,external_id:input.outcome.external_id??attempt.data.external_id,observation,completed_at:iso(),resent:false,retry_allowed:false}),published_observed:state==='OBSERVED_PUBLISHED',resent:false};
      }
      case'channel.reconcile':{
        inputObject(input,['id','pending_digest','observation']);const attempt=this.g(input.id,'channel_attempt');sha(input.pending_digest);ensure(attempt.data.pending_digest===input.pending_digest,'Pending channel request binding mismatch','Conflict');ensure(['SENT','PROCESSING','UNKNOWN'].includes(attempt.data.state),'Only an uncertain or non-final channel attempt can be reconciled','Conflict');ensure(this.s.db.prepare('SELECT 1 FROM pending WHERE work_id=?').get(attempt.id),'Durable pending channel request is missing','NotFound');
        object(input.observation,['state','source','checked_at','fingerprint','external_id'],['state','source','checked_at']);noSecrets(input.observation);choice(input.observation.state,['published','processing','failed','not_found','unknown']);str(input.observation.source,128);ensure(/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(input.observation.source),'Invalid reconciliation source');str(input.observation.checked_at,64);ensure(Number.isFinite(Date.parse(input.observation.checked_at)),'Invalid reconciliation time');
        if(input.observation.fingerprint)str(input.observation.fingerprint,512);if(input.observation.external_id)str(input.observation.external_id,256);if(input.observation.state==='published')ensure(input.observation.fingerprint,'Published reconciliation requires a destination fingerprint','PolicyDenied');
        const outcome=input.observation.state.toUpperCase(),state=input.observation.state==='published'?'OBSERVED_PUBLISHED':input.observation.state==='processing'?'PROCESSING':input.observation.state==='unknown'?'UNKNOWN':'FAILED';
        const retry_allowed=input.observation.state==='not_found'&&attempt.data.channel_policy.idempotency!=='none';this.s.db.prepare('UPDATE pending SET state=? WHERE work_id=?').run('RECONCILED',attempt.id);
        return{entity:this.s.update(attempt.id,{...attempt.data,state,dispatch_state:'RECONCILED',external_state:state,reconciliation_outcome:outcome,reconciliation:{...input.observation},external_id:input.observation.external_id??attempt.data.external_id,retry_allowed,resent:false,last_transition_at:iso()}),resent:false,retry_allowed,automatic_resend:false};
      }
      case'channel.withdraw_plan':{
        inputObject(input,['id','reason','scope','replacement_candidate_id'],['id','reason','scope']);const attempt=this.g(input.id,'channel_attempt');ensure(attempt.data.state!=='PREPARED','Nothing has left the prepared state','Conflict');lines(input.reason,8000);choice(input.scope,['destination-resource','published-version','known-owned-copies']);
        let replacement=null;if(input.replacement_candidate_id){replacement=this.g(input.replacement_candidate_id,'candidate');ensure(replacement.data.release_id===attempt.data.release_id,'Replacement candidate belongs to another release','PermissionDenied');ensure(this.inspectCandidate(replacement).fresh,'Replacement candidate is stale','StaleReference');}
        return{entity:this.s.create('withdrawal',{release_id:attempt.data.release_id,name:`Withdrawal plan · ${attempt.data.name}`,channel_attempt_id:attempt.id,channel_profile_id:attempt.data.channel_profile_id,candidate_id:attempt.data.candidate_id,reason:input.reason,scope:input.scope,replacement_candidate_id:replacement?.id??null,channel_capability:attempt.data.channel_policy.withdrawal,state:'PLAN_ONLY',external_action_performed:false,all_copies_removed:false,universe_complete:false,planned_by:this.principal,planned_at:iso(),note:'This plan cannot prove deletion from downstream copies or caches.'})};
      }
      case'document.create':{
        const data=this.documentData(input);return{entity:this.s.create('document',{...data,created_at:iso(),updated_at:iso()})};
      }
      case'document.edit_human':{
        inputObject(input,['id','expected','block_id','content']);const document=this.g(input.id,'document');ensure(sameVersion(document.version,input.expected),'Document revision changed','StaleReference');lines(input.content,12000);const hit=this.documentBlock(document,input.block_id);ensure(hit.section.owner==='human'&&hit.block.owner==='human','Only human-owned blocks may be directly edited','PermissionDenied');
        const sections=structuredClone(document.data.sections);sections[hit.si].blocks[hit.bi].content=input.content;return{entity:this.s.update(document.id,{...document.data,sections,updated_at:iso(),last_human_editor:this.principal})};
      }
      case'document.propose':{
        inputObject(input,['id','expected','changes','reason'],['id','expected','changes']);const document=this.g(input.id,'document');ensure(sameVersion(document.version,input.expected),'Document revision changed','StaleReference');array(input.changes,64);ensure(input.changes.length>0,'Empty document proposal');if(input.reason)lines(input.reason,4000);
        const seen=new Set(),changes=input.changes.map(change=>{object(change,['block_id','content','reason'],['block_id','content']);str(change.block_id,64);ensure(!seen.has(change.block_id),'Duplicate proposed block');seen.add(change.block_id);lines(change.content,12000);if(change.reason)lines(change.reason,2000);const hit=this.documentBlock(document,change.block_id);ensure(hit.section.owner==='managed'&&hit.block.owner==='managed','Managed proposal cannot overwrite a human/imported block','PermissionDenied');return{...change};});
        return{entity:this.s.create('proposal',{release_id:document.data.release_id,name:'Proposal · '+document.data.name,document_id:document.id,document_version:document.version,external_base:document.data.external_base,changes,reason:input.reason??'',state:'OPEN',proposed_by:this.principal,proposed_at:iso(),external_apply:'NOT_PERFORMED'})};
      }
      case'document.resolve':{
        inputObject(input,['proposal_id','decision','expected_document','comment','observed_external_revision'],['proposal_id','decision','expected_document','comment']);const proposal=this.g(input.proposal_id,'proposal');ensure(proposal.data.state==='OPEN','Proposal already resolved','Conflict');choice(input.decision,['approve','request-changes','reject']);lines(input.comment,8000);const document=this.g(proposal.data.document_id,'document');ensure(sameVersion(document.version,input.expected_document),'Document revision changed','StaleReference');ensure(sameVersion(document.version,proposal.data.document_version),'Proposal base is stale','StaleReference');
        if(document.data.external_base){str(input.observed_external_revision??'',256);ensure(input.observed_external_revision===document.data.external_base.revision,'External docs base changed','StaleReference');}
        if(input.decision!=='approve')return{entity:this.s.update(proposal.id,{...proposal.data,state:input.decision==='reject'?'REJECTED':'CHANGES_REQUESTED',resolved_by:this.principal,resolved_at:iso(),comment:input.comment})};
        const sections=structuredClone(document.data.sections);for(const change of proposal.data.changes){const hit=this.documentBlock({...document,data:{...document.data,sections}},change.block_id);ensure(hit.section.owner==='managed'&&hit.block.owner==='managed','Proposal target ownership changed','StaleReference');sections[hit.si].blocks[hit.bi].content=change.content;}
        const updated=this.s.update(document.id,{...document.data,sections,updated_at:iso(),last_managed_proposal:proposal.id});this.s.update(proposal.id,{...proposal.data,state:'APPLIED',resolved_by:this.principal,resolved_at:iso(),comment:input.comment,applied_document_version:updated.version});return{entity:updated,proposal_id:proposal.id,external_apply:'NOT_PERFORMED'};
      }
      case'document.render':{
        inputObject(input,['id']);const document=this.g(input.id,'document'),release=this.g(document.data.release_id,'release'),target=this.g(document.data.target_id,'target'),refs=this.documentRefs(document),content=this.documentContent(document);
        const deliverable=this.s.create('deliverable',{release_id:release.id,name:document.data.name,target_id:target.id,format:document.data.format,content,claim_ids:refs.claim_ids,source_ids:refs.source_ids,document_origin:{id:document.id,version:document.version},publication_state:'DRAFT'}),rendered=renderText(deliverable,target,release),hash=this.s.blob(rendered.bytes,rendered.mime);
        return{entity:this.s.create('artifact',{name:document.data.name,release_id:release.id,target_id:target.id,deliverable_id:deliverable.id,sha256:hash,size_bytes:rendered.bytes.length,mime:rendered.mime,extension:rendered.extension,inputs:this.dependencies(deliverable),classification:'editorial',producer:'launchwright-document/1',draft:true,technical:'UNKNOWN'}),deliverable};
      }
      case'translation.create':{
        inputObject(input,['source_id','target_id','glossary_id','font_profile_id','name','text','origin']);const source=this.g(input.source_id),sourceInfo=this.sourceText(source),target=this.g(input.target_id,'target'),release=this.g(target.data.release_id,'release'),glossary=this.g(input.glossary_id,'glossary'),font=this.g(input.font_profile_id,'font_profile');ensure(this.productOf(source)===release.data.product_id,'Translation source/product mismatch','PermissionDenied');ensure(glossary.data.product_id===release.data.product_id&&font.data.product_id===release.data.product_id,'Translation policy/product mismatch','PermissionDenied');ensure(glossary.data.source_locale===sourceInfo.locale,'Glossary source locale mismatch');ensure(glossary.data.target_locale===target.data.editorial_locale,'Glossary target locale mismatch');ensure(font.data.locales.includes(target.data.editorial_locale),'FontProfile does not cover target locale','PolicyDenied');str(input.name,160);lines(input.text,24000);choice(input.origin,['machine','human']);const risk=this.translationRisk(sourceInfo.text,input.text);
        return{entity:this.s.create('translation',{release_id:release.id,name:input.name,source_id:source.id,source_kind:source.kind,source_version:source.version,target_id:target.id,target_version:target.version,target_locale:target.data.editorial_locale,glossary_id:glossary.id,glossary_version:glossary.version,font_profile_id:font.id,font_profile_version:font.version,text:input.text,origin:input.origin,ownership:input.origin==='human'?'human':'managed',state:input.origin==='human'?'HUMAN_EDITED':'MACHINE_DRAFT',semantic_verification:'PENDING_HUMAN_REVIEW',risk_at_creation:risk,created_by:this.principal,created_at:iso()})};
      }
      case'translation.edit_human':{
        inputObject(input,['id','expected','text']);const translation=this.g(input.id,'translation');ensure(sameVersion(translation.version,input.expected),'Translation revision changed','StaleReference');lines(input.text,24000);const inspected=this.inspectTranslation(translation);ensure(inspected.reviewable,'Translation inputs changed; rebase before editing','StaleReference');const source=this.g(translation.data.source_id),risk=this.translationRisk(this.sourceText(source).text,input.text);
        return{entity:this.s.update(translation.id,{...translation.data,text:input.text,origin:'human',ownership:'human',state:'HUMAN_EDITED',semantic_verification:'PENDING_HUMAN_REVIEW',risk_at_last_edit:risk,review:null,last_human_editor:this.principal,updated_at:iso()})};
      }
      case'translation.rebase':{
        inputObject(input,['id','expected']);const translation=this.g(input.id,'translation');ensure(sameVersion(translation.version,input.expected),'Translation revision changed','StaleReference');const source=this.g(translation.data.source_id),target=this.g(translation.data.target_id,'target'),glossary=this.g(translation.data.glossary_id,'glossary'),font=this.g(translation.data.font_profile_id,'font_profile');const sourceInfo=this.sourceText(source);ensure(glossary.data.source_locale===sourceInfo.locale&&glossary.data.target_locale===target.data.editorial_locale,'Current glossary no longer matches translation locales','PolicyDenied');ensure(font.data.locales.includes(target.data.editorial_locale),'Current FontProfile no longer covers target locale','PolicyDenied');const prior={source_version:translation.data.source_version,target_version:translation.data.target_version??null,glossary_version:translation.data.glossary_version,font_profile_version:translation.data.font_profile_version};
        return{entity:this.s.update(translation.id,{...translation.data,source_version:source.version,target_version:target.version,target_locale:target.data.editorial_locale,glossary_version:glossary.version,font_profile_version:font.version,origin:'human',ownership:'human',state:'HUMAN_EDITED',semantic_verification:'PENDING_HUMAN_REVIEW',review:null,risk_at_rebase:this.translationRisk(sourceInfo.text,translation.data.text),rebase_from:prior,rebased_by:this.principal,rebased_at:iso()}),preserved_text:true};
      }
      case'translation.review':{
        inputObject(input,['id','expected','decision','comment','risk_acknowledgement'],['id','expected','decision','comment']);const translation=this.g(input.id,'translation');ensure(sameVersion(translation.version,input.expected),'Translation revision changed','StaleReference');choice(input.decision,['approve','request-changes']);lines(input.comment,8000);const inspected=this.inspectTranslation(translation);ensure(inspected.reviewable,'Translation inputs changed','StaleReference');
        if(input.decision==='approve'&&inspected.risk.requires_human_semantic_review)ensure(input.risk_acknowledgement==='human-semantic-review','Critical lexical changes require explicit human semantic review','ConsentRequired');
        const state=input.decision==='approve'?'REVIEWED_FOR_TARGET':'HUMAN_EDITED';return{entity:this.s.update(translation.id,{...translation.data,state,semantic_verification:input.decision==='approve'?'HUMAN_REVIEWED':'PENDING_HUMAN_REVIEW',review:{decision:input.decision,comment:input.comment,reviewer:this.principal,reviewed_at:iso(),risk_acknowledgement:input.risk_acknowledgement??null}})};
      }
      case'translation.render':{
        inputObject(input,['id']);const translation=this.g(input.id,'translation'),inspected=this.inspectTranslation(translation);ensure(inspected.computed_state==='REVIEWED_FOR_TARGET','Translation is not current and reviewed','PolicyDenied');const source=this.g(translation.data.source_id),sourceInfo=this.sourceText(source),release=this.g(translation.data.release_id,'release'),target=this.g(translation.data.target_id,'target');
        const deliverable=this.s.create('deliverable',{release_id:release.id,name:translation.data.name,target_id:target.id,format:'markdown',content:translation.data.text,claim_ids:sourceInfo.claim_ids,source_ids:sourceInfo.source_ids,translation_origin:{id:translation.id,version:translation.version},publication_state:'DRAFT'}),rendered=renderText(deliverable,target,release),hash=this.s.blob(rendered.bytes,rendered.mime);
        return{entity:this.s.create('artifact',{name:translation.data.name,release_id:release.id,target_id:target.id,deliverable_id:deliverable.id,sha256:hash,size_bytes:rendered.bytes.length,mime:rendered.mime,extension:rendered.extension,inputs:this.dependencies(deliverable),classification:'editorial',producer:'launchwright-translation/1',draft:true,technical:'UNKNOWN'}),deliverable};
      }
      case'extension.register':{
        const data=this.validateExtension(input),duplicate=this.l('extension_contract').find(e=>e.data.state==='ACTIVE'&&e.data.type===data.type&&e.data.package.name===data.package.name&&e.data.contract_version===data.contract_version);ensure(!duplicate,'Extension contract already registered','Conflict');
        return{entity:this.s.create('extension_contract',{...data,state:'ACTIVE',registered_by:this.principal,registered_at:iso(),toolchain_lock:{app_version:APP_VERSION,app_schema_version:'launchwright/1',native_sdk:'0.9.0-dev.1',package_sha256:data.package.sha256,contract_version:data.contract_version},code_payload:'NOT_STORED'})};
      }
      case'extension.retire':{
        inputObject(input,['id','expected','reason']);const e=this.g(input.id,'extension_contract');ensure(sameVersion(e.version,input.expected),'Extension revision changed','StaleReference');ensure(e.data.state==='ACTIVE','Extension already retired','Conflict');lines(input.reason,4000);const prepared=this.s.all().filter(x=>x.id!==e.id&&['work','channel_attempt'].includes(x.kind)&&!['COMPLETED','RECONCILED','OBSERVED_PUBLISHED','FAILED'].includes(x.data.state)&&this.containsRef(x.data,e.id)).map(x=>({id:x.id,kind:x.kind,state:x.data.state}));
        return{entity:this.s.update(e.id,{...e.data,state:'RETIRED',retired_by:this.principal,retired_at:iso(),retire_reason:input.reason,prepared_refs:prepared}),prepared_refs:prepared,historical_records_preserved:true};
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
