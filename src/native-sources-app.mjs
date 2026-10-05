// SPDX-License-Identifier: AGPL-3.0-only
import { NativeError } from '@semwright/native-sdk';
import { inputObject } from './contracts.mjs';
import { NativeProfileApplication } from './native-profile-base.mjs';
import { PROFILE_MATRIX, profilePreflight } from './source-profiles.mjs';

export const SOURCES_NATIVE_READS=Object.freeze(['profile.matrix','profile.preflight']);
export const SOURCES_NATIVE_OPERATIONS=SOURCES_NATIVE_READS;

export class SourcesNativeApplication extends NativeProfileApplication {
  constructor(root,{readOnly=false,principal='native-host-delegate',capabilities={}}={}) {
    super(root,{readOnly,principal,readOperations:SOURCES_NATIVE_READS,operations:SOURCES_NATIVE_OPERATIONS,capabilities});
  }
  read(operation,input){
    if(operation==='profile.matrix'){
      inputObject(input,[]);
      return{profiles:PROFILE_MATRIX,execution_proof:false};
    }
    if(operation==='profile.preflight')return profilePreflight(this,input);
    throw new NativeError('Unsupported','Read operation is outside sources profile');
  }
}
