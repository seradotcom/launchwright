// SPDX-License-Identifier: AGPL-3.0-only
import { NativeError, requireCondition as ensure } from '@semwright/native-sdk';
import { NativeProfileApplication } from './native-profile-base.mjs';
import { validateVerification } from './records.mjs';
import { iso } from './base.mjs';
import { admitCanonicalVerifierRuntime } from './verification-runtime.mjs';

export const VERIFIER_NATIVE_READS=Object.freeze([]);
export const VERIFIER_NATIVE_MUTATIONS=Object.freeze(['verification.record']);
export const VERIFIER_NATIVE_OPERATIONS=Object.freeze([...VERIFIER_NATIVE_MUTATIONS]);

export class VerifierNativeApplication extends NativeProfileApplication {
  constructor(root,options={}){
    super(root,{...options,readOperations:VERIFIER_NATIVE_READS,operations:VERIFIER_NATIVE_OPERATIONS});
    this.verificationReceiptRoot=options.verificationReceiptRoot??null;
  }
  read(){throw new NativeError('Unsupported','Read operation is outside verifier profile');}
  mutate(operation,input){
    switch(operation){
      case'verification.record':{
        const data=validateVerification(input),candidate=this.get(data.candidate_id,'candidate');
        const artifactSet=new Set(candidate.data.manifest.artifact_ids);
        for(const id of data.artifact_ids)ensure(artifactSet.has(id),'Verification artifact is outside candidate','PermissionDenied');
        if(data.target_id){
          const target=this.get(data.target_id,'target');
          ensure(target.data.release_id===candidate.data.release_id,'Verification target belongs to another release','PermissionDenied');
        }
        const runtimeAdmission=data.verifier.authority==='canonical'?admitCanonicalVerifierRuntime(this,candidate,data):null;
        const admission=data.verifier.authority==='canonical'?'canonical-owner-admitted':data.verifier.authority==='heuristic'?'heuristic-report':'local-review-record';
        return{entity:this.store.create('verification',{
          release_id:candidate.data.release_id,
          name:data.dimension+' verification',
          ...data,
          admission,
          runtime_admission:runtimeAdmission,
          recorded_by:this.principal,
          recorded_at:iso()
        })};
      }
      default:throw new NativeError('Unsupported','Mutation is outside verifier profile');
    }
  }
}
