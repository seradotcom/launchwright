// SPDX-License-Identifier: AGPL-3.0-only
import { bridgeEntrypoint } from '@semwright/native-sdk';
import { ExtensionRuntimeNativeApplication } from './native-extension-runtime-app.mjs';
export const nativeExtensionRuntimeApplication=(paths,readOnly)=>new ExtensionRuntimeNativeApplication(paths.data_root,{readOnly,extensionReceiptRoot:paths.output_root});
export const semwrightNativeBridgeMain=bridgeEntrypoint(nativeExtensionRuntimeApplication);
