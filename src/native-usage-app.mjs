// SPDX-License-Identifier: AGPL-3.0-only
import { NativeError } from '@semwright/native-sdk';
import { NativeProfileApplication } from './native-profile-base.mjs';
import { inputObject } from './contracts.mjs';
import { inspectUsage, recordUsageReservation, recordUsageReceipt, finalizeUsage, recordBillingEvent, recordPerformanceSample } from './usage.mjs';

export const USAGE_NATIVE_READS=Object.freeze(['usage.inspect']);
export const USAGE_NATIVE_MUTATIONS=Object.freeze([
  'usage.reserve_record','usage.receipt_record','usage.finalize','usage.billing_record','usage.performance_record'
]);
export const USAGE_NATIVE_OPERATIONS=Object.freeze([...USAGE_NATIVE_READS,...USAGE_NATIVE_MUTATIONS]);

export class UsageNativeApplication extends NativeProfileApplication {
  constructor(root,options={}){super(root,{...options,readOperations:USAGE_NATIVE_READS,operations:USAGE_NATIVE_OPERATIONS});}
  read(operation,input){
    if(operation==='usage.inspect')return inspectUsage(this,input);
    throw new NativeError('Unsupported','Read operation is outside usage profile');
  }
  mutate(operation,input){
    switch(operation){
      case'usage.reserve_record':return recordUsageReservation(this,input);
      case'usage.receipt_record':return recordUsageReceipt(this,input);
      case'usage.finalize':return finalizeUsage(this,input);
      case'usage.billing_record':return recordBillingEvent(this,input);
      case'usage.performance_record':return recordPerformanceSample(this,input);
      default:throw new NativeError('Unsupported','Mutation is outside usage profile');
    }
  }
}
