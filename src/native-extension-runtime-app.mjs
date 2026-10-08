// SPDX-License-Identifier: AGPL-3.0-only
import { NativeError } from '@semwright/native-sdk';
import { NativeProfileApplication } from './native-profile-base.mjs';
import { recordExtensionResult } from './extensions.mjs';
import { recordCliObservation } from './cli-source.mjs';
import { admitRendererRuntime, admitCliRuntime } from './extension-runtime.mjs';

export const EXTENSION_RUNTIME_NATIVE_READS=Object.freeze([]);
export const EXTENSION_RUNTIME_NATIVE_MUTATIONS=Object.freeze(['extension.result_record','source.cli_ingest']);
export const EXTENSION_RUNTIME_NATIVE_OPERATIONS=Object.freeze([...EXTENSION_RUNTIME_NATIVE_MUTATIONS]);

export class ExtensionRuntimeNativeApplication extends NativeProfileApplication {
  constructor(root,options={}){
    super(root,{...options,readOperations:EXTENSION_RUNTIME_NATIVE_READS,operations:EXTENSION_RUNTIME_NATIVE_OPERATIONS});
    this.extensionReceiptRoot=options.extensionReceiptRoot??null;
  }
  read(){throw new NativeError('Unsupported','Read operation is outside extension runtime profile');}
  mutate(operation,input){
    switch(operation){
      case'extension.result_record':{
        const admission=input.runtime_receipt?admitRendererRuntime(this,input):null;
        return{entity:recordExtensionResult(this,input,admission)};
      }
      case'source.cli_ingest':{
        const admission=input.runtime_receipt?admitCliRuntime(this,input):null;
        return{entity:recordCliObservation(this,input,admission)};
      }
      default:throw new NativeError('Unsupported','Mutation is outside extension runtime profile');
    }
  }
}
