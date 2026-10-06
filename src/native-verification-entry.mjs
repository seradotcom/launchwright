// SPDX-License-Identifier: AGPL-3.0-only
import { bridgeEntrypoint } from '@semwright/native-sdk';
import { VerificationNativeApplication } from './native-verification-app.mjs';
export const nativeVerificationApplication=(paths,readOnly)=>new VerificationNativeApplication(paths.data_root,{readOnly});
export const semwrightNativeBridgeMain=bridgeEntrypoint(nativeVerificationApplication);
