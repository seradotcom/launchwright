// SPDX-License-Identifier: AGPL-3.0-only
import { bridgeEntrypoint } from '@semwright/native-sdk';
import { SourcesNativeApplication } from './native-sources-app.mjs';
export const nativeSourcesApplication=(paths,readOnly)=>new SourcesNativeApplication(paths.data_root,{readOnly});
export const semwrightNativeBridgeMain=bridgeEntrypoint(nativeSourcesApplication);
