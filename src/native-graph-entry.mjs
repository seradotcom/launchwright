// SPDX-License-Identifier: AGPL-3.0-only
import { bridgeEntrypoint } from '@semwright/native-sdk';
import { GraphNativeApplication } from './native-graph-app.mjs';
export const nativeGraphApplication=(paths,readOnly)=>new GraphNativeApplication(paths.data_root,{readOnly});
export const semwrightNativeBridgeMain=bridgeEntrypoint(nativeGraphApplication);
