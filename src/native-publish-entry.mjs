// SPDX-License-Identifier: AGPL-3.0-only
import { bridgeEntrypoint } from '@semwright/native-sdk';
import { PublishNativeApplication } from './native-publish-app.mjs';
export const nativePublishApplication=(paths,readOnly)=>new PublishNativeApplication(paths.data_root,{readOnly});
export const semwrightNativeBridgeMain=bridgeEntrypoint(nativePublishApplication);
