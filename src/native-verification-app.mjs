// SPDX-License-Identifier: AGPL-3.0-only
import { NativeError } from '@semwright/native-sdk';
import { NativeProfileApplication } from './native-profile-base.mjs';
import { inputObject } from './contracts.mjs';
import { recordVerification, verificationSummary, recordWaiver } from './verification.mjs';

export const VERIFICATION_NATIVE_READS=Object.freeze(['verification.summary']);
export const VERIFICATION_NATIVE_MUTATIONS=Object.freeze(['verification.record','waiver.record']);
export const VERIFICATION_NATIVE_OPERATIONS=Object.freeze([...VERIFICATION_NATIVE_READS,...VERIFICATION_NATIVE_MUTATIONS]);

export class VerificationNativeApplication extends NativeProfileApplication{
  constructor(root,options={}){super(root,{...options,readOperations:VERIFICATION_NATIVE_READS,operations:VERIFICATION_NATIVE_OPERATIONS});}
  read(operation,input){
    switch(operation){
      case'verification.summary':inputObject(input,['candidate_id']);return verificationSummary(this,input.candidate_id);
      default:throw new NativeError('Unsupported','Read operation is outside verification profile');
    }
  }
  mutate(operation,input){
    switch(operation){
      case'verification.record':return recordVerification(this,input);
      case'waiver.record':return recordWaiver(this,input);
      default:throw new NativeError('Unsupported','Mutation is outside verification profile');
    }
  }
}
