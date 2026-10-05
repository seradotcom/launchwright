// SPDX-License-Identifier: AGPL-3.0-only
import { NativeError } from '@semwright/native-sdk';
import { NativeProfileApplication } from './native-profile-base.mjs';
import { inspectGraph, recordGraphObservation } from './graph.mjs';

export const GRAPH_NATIVE_READS=Object.freeze(['graph.inspect']);
export const GRAPH_NATIVE_MUTATIONS=Object.freeze(['graph.record']);
export const GRAPH_NATIVE_OPERATIONS=Object.freeze([...GRAPH_NATIVE_READS,...GRAPH_NATIVE_MUTATIONS]);

export class GraphNativeApplication extends NativeProfileApplication {
  constructor(root,options={}){super(root,{...options,readOperations:GRAPH_NATIVE_READS,operations:GRAPH_NATIVE_OPERATIONS});}
  read(operation,input){
    if(operation==='graph.inspect')return inspectGraph(this,input);
    throw new NativeError('Unsupported','Read operation is outside graph profile');
  }
  mutate(operation,input){
    if(operation==='graph.record')return recordGraphObservation(this,input);
    throw new NativeError('Unsupported','Mutation is outside graph profile');
  }
}
