// SPDX-License-Identifier: AGPL-3.0-only
import { bridgeEntrypoint } from '@semwright/native-sdk';
import { UsageNativeApplication } from './native-usage-app.mjs';
export const nativeUsageApplication=(paths,readOnly)=>new UsageNativeApplication(paths.data_root,{readOnly});
export const semwrightNativeBridgeMain=bridgeEntrypoint(nativeUsageApplication);
