// SPDX-License-Identifier: AGPL-3.0-only
import { bridgeEntrypoint } from '@semwright/native-sdk';
import { WorkNativeApplication } from './native-work-app.mjs';
export const nativeWorkApplication=(paths,readOnly)=>new WorkNativeApplication(paths.data_root,{readOnly});
export const semwrightNativeBridgeMain=bridgeEntrypoint(nativeWorkApplication);
