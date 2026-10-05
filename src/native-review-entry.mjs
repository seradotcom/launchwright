// SPDX-License-Identifier: AGPL-3.0-only
import { bridgeEntrypoint } from '@semwright/native-sdk';
import { ReviewNativeApplication } from './native-review-app.mjs';
export const nativeReviewApplication=(paths,readOnly)=>new ReviewNativeApplication(paths.data_root,{readOnly});
export const semwrightNativeBridgeMain=bridgeEntrypoint(nativeReviewApplication);
