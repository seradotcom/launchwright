// SPDX-License-Identifier: AGPL-3.0-only
import { NativeError, requireCondition as ensure, sameVersion } from '@semwright/native-sdk';
import { NativeProfileApplication } from './native-profile-base.mjs';
import { inputObject, array, choice, str } from './contracts.mjs';
import { graphContract, recordGraphObservation, inspectGraphObservation, latestGraphObservation, assertObservedGraphEdge, cacheIdentity, createImpactProposal, coalesceImpact, recordRebuildReceipt, GRAPH_RELATIONS } from './graph.mjs';

export const GRAPH_NATIVE_READS=Object.freeze([
  'release.impact','graph.contract','graph.inspect','graph.cache_assess'
]);
export const GRAPH_NATIVE_MUTATIONS=Object.freeze([
  'relation.record','impact.plan','graph.observation_record','impact.coalesce','impact.receipt_record'
]);
export const GRAPH_NATIVE_OPERATIONS=Object.freeze([...GRAPH_NATIVE_READS,...GRAPH_NATIVE_MUTATIONS]);

export class GraphNativeApplication extends NativeProfileApplication {
  constructor(root,options={}){
    super(root,{...options,capabilities:{...(options.capabilities??{}),canonical_graph_admission:true},readOperations:GRAPH_NATIVE_READS,operations:GRAPH_NATIVE_OPERATIONS});
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
  contractBlockers(releaseId){
    const claims=this.list('claim',releaseId).map(c=>this.claimCheck(c)),byClaim=new Map(claims.map(c=>[c.claim_id,c]));
    const blockers=[];
    for(const contract of this.list('release_contract',releaseId)){
      for(const id of contract.data.required_claim_ids){
        const check=byClaim.get(id)??{status:'UNKNOWN',reasons:['claim-not-enumerated']};
        if(check.status!=='PASS')blockers.push({contract_id:contract.id,kind:'claim',id,state:check.status,reasons:check.reasons});
      }
      for(const id of contract.data.required_deliverable_ids){
        const artifacts=this.list('artifact',releaseId).filter(a=>a.data.deliverable_id===id);let state='UNKNOWN',reasons=['no-current-artifact'];
        for(const artifact of artifacts){
          if(this.freshness(artifact.data.inputs).length)continue;
          try{this.store.readBlob(artifact.data.sha256);state='PASS';reasons=[];break;}catch{state='FAIL';reasons=['artifact-integrity-failed'];}
        }
        if(state!=='PASS')blockers.push({contract_id:contract.id,kind:'deliverable',id,state,reasons});
      }
    }
    return blockers;
  }
  impact(releaseId){
    this.get(releaseId,'release');const items=[];
    for(const artifact of this.list('artifact',releaseId)){
      const changed=this.freshness(artifact.data.inputs);
      if(changed.length)items.push({artifact_id:artifact.id,deliverable_id:artifact.data.deliverable_id,state:'INPUTS_CHANGED',changed});
    }
    const bindings=this.list('binding',releaseId).map(b=>({binding_id:b.id,mode:b.data.mode,action:b.data.mode==='rolling'?'revalidate-if-inputs-changed':'retain-pinned-history',pinned_artifact_id:b.data.pinned_artifact_id??null}));
    const relations=this.list('relation',releaseId).map(r=>({id:r.id,from_id:r.data.from_id,to_id:r.data.to_id,kind:r.data.relation_kind,provenance:r.data.provenance,completeness:r.data.completeness,admission:r.data.admission,graph_observation_id:r.data.graph_observation_id??null}));
    const contract_blockers=this.contractBlockers(releaseId),admitted=latestGraphObservation(this,releaseId);
    if(admitted){
      const graph=inspectGraphObservation(this,{id:admitted.id});
      return{release_id:releaseId,items,bindings,contract_blockers,relations,graph,coverage:'CANONICAL_PROJECT_GRAPH_PROJECTION',canonical_graph_authority:true,unknown_frontier:graph.impact.unknown_frontier,note:'Canonical Project Graph freshness and impact are projected from an immutable Host-admitted observation. Local revision comparisons remain supplemental.'};
    }
    return{release_id:releaseId,items,bindings,contract_blockers,relations,graph:null,coverage:'DECLARED_DEPENDENCIES_ONLY',canonical_graph_authority:false,unknown_frontier:true,note:'This is an app input-revision comparison, explicit relation inventory and release-contract projection, not a Project Graph freshness verdict.'};
  }
  read(operation,input){
    switch(operation){
      case'release.impact':inputObject(input,['release_id']);return this.impact(input.release_id);
      case'graph.contract':inputObject(input,[]);return graphContract();
      case'graph.inspect':return inspectGraphObservation(this,input);
      case'graph.cache_assess':return cacheIdentity(this,input);
      default:throw new NativeError('Unsupported','Read operation is outside graph profile');
    }
  }
  mutate(operation,input){
    switch(operation){
      case'relation.record':{
        inputObject(input,['release_id','name','from_id','to_id','relation_kind','provenance','completeness','evidence_ids','graph_observation_id'],['release_id','name','from_id','to_id','relation_kind','provenance','completeness']);
        const release=this.get(input.release_id,'release'),from=this.get(input.from_id),to=this.get(input.to_id);
        str(input.name,160);str(input.relation_kind,128);ensure(/^[a-z][a-z0-9_.-]{0,127}$/.test(input.relation_kind),'Invalid relation kind');
        ensure(this.productOf(from)===release.data.product_id&&this.productOf(to)===release.data.product_id,'Relation crosses product boundary','PermissionDenied');
        choice(input.provenance,['declared','imported','heuristic','observed']);choice(input.completeness,['complete','partial','unknown']);
        if(input.provenance==='heuristic')ensure(input.completeness!=='complete','Heuristic relation cannot claim complete coverage');
        const evidenceIds=input.evidence_ids??[];array(evidenceIds,32);ensure(new Set(evidenceIds).size===evidenceIds.length,'Duplicate relation evidence');
        for(const id of evidenceIds){const evidence=this.get(id,'evidence');ensure(evidence.data.release_id===release.id,'Relation evidence belongs to another release');}
        let graphObservationId=null;
        if(input.provenance==='observed'){
          ensure(input.graph_observation_id,'Observed relation requires an admitted Project Graph observation');choice(input.relation_kind,GRAPH_RELATIONS);
          const supported=assertObservedGraphEdge(this,input.graph_observation_id,from,to,input.relation_kind);ensure(supported.observation.data.release_id===release.id,'Graph observation belongs to another release','Conflict');graphObservationId=supported.observation.id;
        }else ensure(input.graph_observation_id===undefined,'Only observed relations may bind canonical Graph observations');
        return{entity:this.store.create('relation',{release_id:release.id,name:input.name,from_id:from.id,to_id:to.id,relation_kind:input.relation_kind,provenance:input.provenance,completeness:input.completeness,evidence_ids:evidenceIds,graph_observation_id:graphObservationId,from_version:from.version,to_version:to.version,admission:input.provenance==='observed'?'canonical-owner-admitted':'local-explicit-record',created_at:new Date().toISOString()})};
      }
      case'impact.plan':return{entity:createImpactProposal(this,input)};
      case'graph.observation_record':return recordGraphObservation(this,input);
      case'impact.coalesce':return{entity:coalesceImpact(this,input)};
      case'impact.receipt_record':return{entity:recordRebuildReceipt(this,input)};
      default:throw new NativeError('Unsupported','Mutation is outside graph profile');
    }
  }
}
