// SPDX-License-Identifier: AGPL-3.0-only
import { bridgeEntrypoint } from '@semwright/native-sdk';
import { CoreNativeApplication } from './native-core-app.mjs';
export const nativeCoreApplication=(paths,readOnly)=>new CoreNativeApplication(paths.data_root,{readOnly});
export const semwrightNativeBridgeMain=bridgeEntrypoint(nativeCoreApplication);
