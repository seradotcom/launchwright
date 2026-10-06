// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import { exactRequestDigest } from '@semwright/native-sdk';

export const APP_VERSION='0.2.0-dev.12';
export const RESOURCE='launchwright:workspace';
export const iso=()=>new Date().toISOString();
export const digest=(domain,value)=>exactRequestDigest('launchwright/'+domain+'/1',value);
export function makeRequest(operation,input,expected,epoch=0,key=randomUUID()){
  return{request:{resource:RESOURCE,epoch,key,request_sha256:digest('request',{app_version:APP_VERSION,operation,input,expected,epoch,key})},input};
}
