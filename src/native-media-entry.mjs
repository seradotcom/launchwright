// SPDX-License-Identifier: AGPL-3.0-only
import { bridgeEntrypoint } from '@semwright/native-sdk';
import { MediaNativeApplication } from './native-media-app.mjs';
export const nativeMediaApplication=(paths,readOnly)=>new MediaNativeApplication(paths.data_root,{readOnly});
export const semwrightNativeBridgeMain=bridgeEntrypoint(nativeMediaApplication);
