// SPDX-License-Identifier: AGPL-3.0-only
import { NativeError, requireCondition as ensure, sameVersion, integer } from '@semwright/native-sdk';
import { NativeProfileApplication } from './native-profile-base.mjs';
import { CLASSES, RIGHTS, inputObject, array, choice, str, lines, sha } from './contracts.mjs';
import { iso } from './base.mjs';
import { recordCapture } from './capture.mjs';
import { renderText } from './render.mjs';

export const PRODUCTION_NATIVE_READS=Object.freeze([
  'release.coverage','anchor.assess','artifact.read'
]);
export const PRODUCTION_NATIVE_MUTATIONS=Object.freeze([
  'evidence.import','capture.ingest','deliverable.render'
]);
export const PRODUCTION_NATIVE_OPERATIONS=Object.freeze([...PRODUCTION_NATIVE_READS,...PRODUCTION_NATIVE_MUTATIONS]);

export class ProductionNativeApplication extends NativeProfileApplication {
  constructor(root,options={}){super(root,{...options,readOperations:PRODUCTION_NATIVE_READS,operations:PRODUCTION_NATIVE_OPERATIONS});}
  dependencies(deliverable){
    const d=deliverable.data,entries=[deliverable,this.get(d.release_id,'release'),this.get(d.target_id,'target')];
    const addClaim=id=>{const c=this.get(id,'claim');entries.push(c);if(c.data.availability_id)entries.push(this.get(c.data.availability_id,'availability'));for(const eid of c.data.evidence_ids)entries.push(this.get(eid,'evidence'));};
    for(const id of d.source_ids)entries.push(this.get(id,'source'));
    for(const id of d.claim_ids)addClaim(id);
    for(const id of d.copy_block_ids??[]){const block=this.get(id,'copy_block');entries.push(block);addClaim(block.data.claim_id);}
    return[...new Map(entries.map(e=>[e.id,{id:e.id,kind:e.kind,version:e.version}])).values()].sort((a,b)=>a.id.localeCompare(b.id));
  }
  claimCheck(claim){
    const c=claim.data,release=this.get(c.release_id,'release'),target=this.get(c.target_id,'target');
    const evidence=c.evidence_ids.map(id=>this.get(id,'evidence')),reasons=[];
    if(!evidence.length)reasons.push('no-evidence');
    for(const e of evidence){
      if(e.data.build!==release.data.build)reasons.push('build-mismatch');
      if(!sameVersion(e.data.target_version,target.version))reasons.push('target-revision-changed');
      if(!['owned','licensed'].includes(e.data.rights))reasons.push('rights-unresolved');
      if(e.data.technical!=='PASS')reasons.push('technical-verification-unknown');
    }
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
    this.get(releaseId,'release');
    const claimEntities=this.list('claim',releaseId),claims=claimEntities.map(c=>this.claimCheck(c)),byClaim=new Map(claims.map(c=>[c.claim_id,c]));
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
    const scenarios=this.list('scenario',releaseId);
    return{release_id:releaseId,claims,obligations:claims.length,pass:claims.filter(c=>c.status==='PASS').length,fail:claims.filter(c=>c.status==='FAIL').length,unknown:claims.filter(c=>c.status==='UNKNOWN').length,contracts,scenarios:scenarios.map(s=>({id:s.id,status:'UNKNOWN',reason:'canonical-execution-not-observed'})),inventory_scope:'registered-only',unknown_frontier:true,canonical_graph_authority:false};
  }
  read(operation,input){
    switch(operation){
      case'release.coverage':inputObject(input,['release_id']);return this.coverage(input.release_id);
      case'anchor.assess':{
        inputObject(input,['id','observed_matches']);const anchor=this.get(input.id,'anchor'),observed=integer(input.observed_matches,0,1000),expected=anchor.data.expected_count,state=observed===expected?'PASS':'FAIL';
        return{anchor_id:anchor.id,state,expected_count:expected,observed_matches:observed,unique:state==='PASS',selected:state==='PASS',reason:state==='PASS'?'unique-anchor':'anchor-cardinality-mismatch'};
      }
      case'artifact.read':{
        inputObject(input,['id']);const a=this.get(input.id,'artifact'),b=this.store.readBlob(a.data.sha256);
        ensure(b.bytes.length<=160000,'Use authenticated artifact download for this output','ResourceExhausted');
        return{artifact:a,text:b.bytes.toString('utf8')};
      }
      default:throw new NativeError('Unsupported','Read operation is outside production profile');
    }
  }
  mutate(operation,input){
    switch(operation){
      case'evidence.import':{
        inputObject(input,['release_id','target_id','source_id','name','build','classification','rights','description','origin_digest','job_id'],['release_id','target_id','source_id','name','build','classification','rights','description','origin_digest']);
        const release=this.get(input.release_id,'release'),target=this.get(input.target_id,'target'),source=this.get(input.source_id,'source');
        ensure(target.data.release_id===release.id&&source.data.product_id===release.data.product_id,'Evidence scope mismatch');
        choice(input.classification,CLASSES);choice(input.rights,RIGHTS);str(input.name,160);str(input.build,256);lines(input.description,8000);sha(input.origin_digest);if(input.job_id)str(input.job_id,96);
        return{entity:this.store.create('evidence',{...input,target_version:target.version,source_version:source.version,admission:'imported-declaration',technical:'UNKNOWN',host_acceptance:'NOT_ESTABLISHED',rights_basis:'operator-declaration',observed_at:iso()})};
      }
      case'capture.ingest':return recordCapture(this,input);
      case'deliverable.render':{
        inputObject(input,['id']);const d=this.get(input.id,'deliverable'),r=this.get(d.data.release_id,'release'),t=this.get(d.data.target_id,'target'),rendered=renderText(d,t,r),hash=this.store.blob(rendered.bytes,rendered.mime);
        return{entity:this.store.create('artifact',{name:d.data.name,release_id:r.id,target_id:t.id,deliverable_id:d.id,sha256:hash,size_bytes:rendered.bytes.length,mime:rendered.mime,extension:rendered.extension,inputs:this.dependencies(d),classification:'editorial',producer:'launchwright-text/1',draft:true,technical:'UNKNOWN'})};
      }
      default:throw new NativeError('Unsupported','Mutation is outside production profile');
    }
  }
}
