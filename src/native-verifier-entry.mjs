// SPDX-License-Identifier: AGPL-3.0-only
import { bridgeEntrypoint } from '@semwright/native-sdk';
import { VerifierNativeApplication } from './native-verifier-app.mjs';
export const nativeVerifierApplication=(paths,readOnly)=>new VerifierNativeApplication(paths.data_root,{readOnly,verificationReceiptRoot:paths.output_root});
export const semwrightNativeBridgeMain=bridgeEntrypoint(nativeVerifierApplication);
