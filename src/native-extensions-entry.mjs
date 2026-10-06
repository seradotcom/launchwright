// SPDX-License-Identifier: AGPL-3.0-only
import { bridgeEntrypoint } from '@semwright/native-sdk';
import { ExtensionsNativeApplication } from './native-extensions-app.mjs';
export const nativeExtensionsApplication=(paths,readOnly)=>new ExtensionsNativeApplication(paths.data_root,{readOnly});
export const semwrightNativeBridgeMain=bridgeEntrypoint(nativeExtensionsApplication);
