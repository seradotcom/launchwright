// SPDX-License-Identifier: AGPL-3.0-only
import { NativeError } from '@semwright/native-sdk';
import { NativeProfileApplication } from './native-profile-base.mjs';
import {
  createReleaseTemplate, updateReleaseTemplate, freezeProductVersion, createDeployment, transitionDeployment,
  prepareInvocation, inspectPublish, exportProductVersion, importProductVersion, rebindImportedTemplate
} from './publish.mjs';

export const PUBLISH_NATIVE_READS=Object.freeze(['publish.inspect']);
export const PUBLISH_NATIVE_MUTATIONS=Object.freeze([
  'publish.template_create','publish.template_update','publish.version_freeze','publish.deployment_create','publish.deployment_transition',
  'publish.invoke_prepare','publish.export','publish.import','publish.import_rebind'
]);
export const PUBLISH_NATIVE_OPERATIONS=Object.freeze([...PUBLISH_NATIVE_READS,...PUBLISH_NATIVE_MUTATIONS]);

export class PublishNativeApplication extends NativeProfileApplication {
  constructor(root,options={}){super(root,{...options,readOperations:PUBLISH_NATIVE_READS,operations:PUBLISH_NATIVE_OPERATIONS});}
  read(operation,input){
    if(operation==='publish.inspect')return inspectPublish(this,input);
    throw new NativeError('Unsupported','Read operation is outside publish profile');
  }
  mutate(operation,input){
    switch(operation){
      case'publish.template_create':return createReleaseTemplate(this,input);
      case'publish.template_update':return updateReleaseTemplate(this,input);
      case'publish.version_freeze':return freezeProductVersion(this,input);
      case'publish.deployment_create':return createDeployment(this,input);
      case'publish.deployment_transition':return transitionDeployment(this,input);
      case'publish.invoke_prepare':return prepareInvocation(this,input);
      case'publish.export':return exportProductVersion(this,input);
      case'publish.import':return importProductVersion(this,input);
      case'publish.import_rebind':return rebindImportedTemplate(this,input);
      default:throw new NativeError('Unsupported','Mutation is outside publish profile');
    }
  }
}
