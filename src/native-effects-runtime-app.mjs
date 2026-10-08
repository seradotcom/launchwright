// SPDX-License-Identifier: AGPL-3.0-only
import {NativeError} from '@semwright/native-sdk';
import {NativeProfileApplication} from './native-profile-base.mjs';
import {recordEffectResult} from './effects.mjs';
import {admitEffectsRuntime} from './effects-runtime.mjs';

export const EFFECTS_RUNTIME_NATIVE_READS=Object.freeze([]);
export const EFFECTS_RUNTIME_NATIVE_MUTATIONS=Object.freeze(['effects.record']);
export const EFFECTS_RUNTIME_NATIVE_OPERATIONS=Object.freeze([...EFFECTS_RUNTIME_NATIVE_MUTATIONS]);

export class EffectsRuntimeNativeApplication extends NativeProfileApplication{
  constructor(root,options={}){
    super(root,{...options,readOperations:EFFECTS_RUNTIME_NATIVE_READS,operations:EFFECTS_RUNTIME_NATIVE_OPERATIONS});
    this.effectsReceiptRoot=options.effectsReceiptRoot??null;
  }
  read(){throw new NativeError('Unsupported','Read operation is outside Effects runtime profile');}
  mutate(operation,input){
    if(operation==='effects.record'){
      const admission=input.runtime_receipt?admitEffectsRuntime(this,input):null;
      return recordEffectResult(this,input,admission);
    }
    throw new NativeError('Unsupported','Mutation is outside Effects runtime profile');
  }
}
