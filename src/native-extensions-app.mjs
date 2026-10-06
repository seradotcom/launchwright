// SPDX-License-Identifier: AGPL-3.0-only
import { NativeError } from '@semwright/native-sdk';
import { NativeProfileApplication } from './native-profile-base.mjs';
import { inputObject } from './contracts.mjs';
import { extensionDiscovery, compatibilityNegotiate, compatibilityInspect, registerExtension, retireExtension, createCompatibilityLock } from './extensions.mjs';

export const EXTENSIONS_NATIVE_READS=Object.freeze(['extension.discovery','compatibility.negotiate','compatibility.inspect']);
export const EXTENSIONS_NATIVE_MUTATIONS=Object.freeze(['extension.register','extension.retire','compatibility.lock']);
export const EXTENSIONS_NATIVE_OPERATIONS=Object.freeze([...EXTENSIONS_NATIVE_READS,...EXTENSIONS_NATIVE_MUTATIONS]);

export class ExtensionsNativeApplication extends NativeProfileApplication {
  constructor(root,options={}){super(root,{...options,readOperations:EXTENSIONS_NATIVE_READS,operations:EXTENSIONS_NATIVE_OPERATIONS});}
  read(operation,input){
    switch(operation){
      case'extension.discovery':return extensionDiscovery(this,input);
      case'compatibility.negotiate':return compatibilityNegotiate(this,input);
      case'compatibility.inspect':inputObject(input,['id']);return compatibilityInspect(this,input.id);
      default:throw new NativeError('Unsupported','Read operation is outside extensions profile');
    }
  }
  mutate(operation,input){
    switch(operation){
      case'extension.register':return registerExtension(this,input);
      case'extension.retire':return retireExtension(this,input);
      case'compatibility.lock':return createCompatibilityLock(this,input);
      default:throw new NativeError('Unsupported','Mutation is outside extensions profile');
    }
  }
}
