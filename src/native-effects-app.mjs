// SPDX-License-Identifier: AGPL-3.0-only
import { NativeError } from '@semwright/native-sdk';
import { NativeProfileApplication } from './native-profile-base.mjs';
import { inspectEffects, recordEffectResult } from './effects.mjs';

export const EFFECTS_NATIVE_READS=Object.freeze(['effects.inspect']);
export const EFFECTS_NATIVE_MUTATIONS=Object.freeze(['effects.record']);
export const EFFECTS_NATIVE_OPERATIONS=Object.freeze([...EFFECTS_NATIVE_READS,...EFFECTS_NATIVE_MUTATIONS]);

export class EffectsNativeApplication extends NativeProfileApplication {
  constructor(root,options={}){super(root,{...options,readOperations:EFFECTS_NATIVE_READS,operations:EFFECTS_NATIVE_OPERATIONS});}
  read(operation,input){
    if(operation==='effects.inspect')return inspectEffects(this,input);
    throw new NativeError('Unsupported','Read operation is outside effects profile');
  }
  mutate(operation,input){
    if(operation==='effects.record')return recordEffectResult(this,input);
    throw new NativeError('Unsupported','Mutation is outside effects profile');
  }
}
