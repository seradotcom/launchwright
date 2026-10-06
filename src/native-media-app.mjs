// SPDX-License-Identifier: AGPL-3.0-only
import { NativeError } from '@semwright/native-sdk';
import { NativeProfileApplication } from './native-profile-base.mjs';
import { createMediaPlan, reviseMediaPlan, inspectMediaPlan, prepareCompositionManifest, recordMediaOutput, recordMediaReview } from './media.mjs';

export const MEDIA_NATIVE_READS=Object.freeze(['media.inspect','media.composition_manifest']);
export const MEDIA_NATIVE_MUTATIONS=Object.freeze(['media.plan','media.revise','media.output_record','media.review_record']);
export const MEDIA_NATIVE_OPERATIONS=Object.freeze([...MEDIA_NATIVE_READS,...MEDIA_NATIVE_MUTATIONS]);

export class MediaNativeApplication extends NativeProfileApplication{
  constructor(root,{readOnly=false,principal='native-host-delegate',capabilities={}}={}){
    super(root,{readOnly,principal,readOperations:MEDIA_NATIVE_READS,operations:MEDIA_NATIVE_OPERATIONS,capabilities});
  }
  read(operation,input){
    switch(operation){
      case'media.inspect':return inspectMediaPlan(this,input);
      case'media.composition_manifest':return prepareCompositionManifest(this,input);
      default:throw new NativeError('Unsupported','Read operation is outside media profile');
    }
  }
  mutate(operation,input){
    switch(operation){
      case'media.plan':return createMediaPlan(this,input);
      case'media.revise':return reviseMediaPlan(this,input);
      case'media.output_record':return recordMediaOutput(this,input);
      case'media.review_record':return recordMediaReview(this,input);
      default:throw new NativeError('Unsupported','Mutation is outside media profile');
    }
  }
}
