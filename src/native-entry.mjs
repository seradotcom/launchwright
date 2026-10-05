// SPDX-License-Identifier: AGPL-3.0-only
import { bridgeEntrypoint, object, text, requireCondition as ensure } from '@semwright/native-sdk';
import { LaunchwrightApplication } from './application.mjs';
import { OPERATION_SCOPES, READ_OPERATIONS } from './contracts.mjs';
export function nativeApplication(paths,readOnly){
  const app=new LaunchwrightApplication(paths.data_root,{readOnly,principal:'native-host-delegate'});
  // Exact command adapter only. The canonical NativeDriver owns ref-to-resource binding.
  for(const [operation,scope] of Object.entries(OPERATION_SCOPES)){
    app.operations.set('driver.launchwright.'+operation.replaceAll('.','-'),(raw,context)=>{
      object(raw,READ_OPERATIONS.has(operation)?['ref','input']:['ref','request','input'],READ_OPERATIONS.has(operation)?['ref','input']:['ref','request','input']);
      text(raw.ref,4096,'canonical reference');
      return app.invoke(operation,READ_OPERATIONS.has(operation)?raw.input:{request:raw.request,input:raw.input},context);
    });
  }
  return app;
}
export const semwrightNativeBridgeMain=bridgeEntrypoint(nativeApplication);
