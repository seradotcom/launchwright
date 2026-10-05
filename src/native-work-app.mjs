// SPDX-License-Identifier: AGPL-3.0-only
import { NativeError, requireCondition as ensure, object, integer } from '@semwright/native-sdk';
import { NativeProfileApplication } from './native-profile-base.mjs';
import { inputObject, str, choice, noSecrets } from './contracts.mjs';
import { digest } from './base.mjs';
import { snapshotSummary } from './snapshot.mjs';
import { PLATFORM_ACTIONS, PUBLICATION_ACTIONS, preparePublicationWork } from './publish-work.mjs';
import { CANONICAL_GRAPH_ACTIONS, CANONICAL_GRAPH_MUTATIONS, prepareGraphWork } from './graph.mjs';

export const WORK_NATIVE_READS=Object.freeze(['workspace.snapshot']);
export const WORK_NATIVE_MUTATIONS=Object.freeze([
  'work.prepare','work.claim','work.complete','work.mark_unknown','workspace.rotate_epoch'
]);
export const WORK_NATIVE_OPERATIONS=Object.freeze([...WORK_NATIVE_READS,...WORK_NATIVE_MUTATIONS]);

export class WorkNativeApplication extends NativeProfileApplication {
  constructor(root,options={}){super(root,{...options,readOperations:WORK_NATIVE_READS,operations:WORK_NATIVE_OPERATIONS});}
  read(operation,input){
    if(operation==='workspace.snapshot'){inputObject(input,[]);return snapshotSummary(this);}
    throw new NativeError('Unsupported','Read operation is outside work profile');
  }
  mutate(operation,input){
    switch(operation){
      case'work.prepare':{
        inputObject(input,['release_id','name','action','arguments','budget','authorization'],['release_id','name','action','arguments','budget']);
        this.get(input.release_id,'release');str(input.name,160);choice(input.action,PLATFORM_ACTIONS);object(input.arguments);noSecrets(input.arguments);
        object(input.budget,['max_cost_microunits','currency','max_runtime_seconds'],['max_cost_microunits','currency','max_runtime_seconds']);
        integer(input.budget.max_cost_microunits,0,1000000000);str(input.budget.currency,8);integer(input.budget.max_runtime_seconds,1,3600);
        let argumentsRecord=input.arguments,publicationBinding=null,graphBinding=null;
        if(CANONICAL_GRAPH_ACTIONS.includes(input.action)){if(CANONICAL_GRAPH_MUTATIONS.has(input.action))ensure(input.authorization==='explicit-graph-mutation','Canonical Project Graph mutation requires explicit per-intent authorization','ConsentRequired');const bound=prepareGraphWork(this,input.release_id,input.action,input.arguments);argumentsRecord=bound.arguments;graphBinding=bound.graph_binding;}
        if(input.action.startsWith('publish.')){if(PUBLICATION_ACTIONS.has(input.action))ensure(input.authorization==='explicit-publication','External publication requires explicit per-intent authorization','ConsentRequired');const bound=preparePublicationWork(this,input.action,input.arguments);argumentsRecord=bound.arguments;publicationBinding=bound.publication_binding;}
        return{entity:this.store.create('work',{...input,arguments:argumentsRecord,...(publicationBinding?{publication_binding:publicationBinding}:{}),...(graphBinding?{graph_binding:graphBinding}:{}),state:'PREPARED',authority:'platform-required',budget_enforced:false,platform_job_id:null,pending_digest:null})};
      }
      case'work.claim':{
        inputObject(input,['id','prepared_record']);const w=this.get(input.id,'work');ensure(w.data.state==='PREPARED','Work has already been claimed; recover rather than resend','Conflict');object(input.prepared_record);noSecrets(input.prepared_record);
        const pending=digest('pending',input.prepared_record);this.store.db.prepare('INSERT INTO pending VALUES(?,?,?)').run(w.id,JSON.stringify(input.prepared_record),'CLAIMED');
        return{entity:this.store.update(w.id,{...w.data,state:'CLAIMED',pending_digest:pending}),pending_digest:pending};
      }
      case'work.complete':{
        inputObject(input,['id','result','pending_digest']);const w=this.get(input.id,'work');ensure(['CLAIMED','OUTCOME_UNKNOWN'].includes(w.data.state),'Work is not awaiting an outcome','Conflict');ensure(w.data.pending_digest===input.pending_digest,'Pending request binding differs','Conflict');object(input.result);noSecrets(input.result);ensure(Buffer.byteLength(JSON.stringify(input.result))<=192000,'Platform result exceeds bounded storage contract','ResourceExhausted');
        const job=input.result.job_id??null;if(job)str(job,96);
        return{entity:this.store.update(w.id,{...w.data,state:'RESPONSE_RECORDED',platform_job_id:job,result:input.result,evidence_trust:'NOT_ADMITTED'})};
      }
      case'work.mark_unknown':{
        inputObject(input,['id']);const w=this.get(input.id,'work');ensure(['CLAIMED','OUTCOME_UNKNOWN'].includes(w.data.state),'Only claimed work can have an unknown send outcome','Conflict');
        return{entity:this.store.update(w.id,{...w.data,state:'OUTCOME_UNKNOWN'})};
      }
      case'workspace.rotate_epoch':{
        inputObject(input,['expected_epoch']);integer(input.expected_epoch,0,Number.MAX_SAFE_INTEGER-1);ensure(this.store.meta().epoch===input.expected_epoch,'Request epoch changed','Conflict');
        const next=input.expected_epoch+1;this.store.db.prepare('UPDATE meta SET epoch=? WHERE singleton=1').run(next);this.store.db.prepare('DELETE FROM receipts WHERE epoch<?').run(Math.max(0,next-1));return{request_epoch:next};
      }
      default:throw new NativeError('Unsupported','Mutation is outside work profile');
    }
  }
}
