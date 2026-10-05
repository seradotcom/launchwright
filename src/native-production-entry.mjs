// SPDX-License-Identifier: AGPL-3.0-only
import { bridgeEntrypoint } from '@semwright/native-sdk';
import { ProductionNativeApplication } from './native-production-app.mjs';
export const nativeProductionApplication=(paths,readOnly)=>new ProductionNativeApplication(paths.data_root,{readOnly});
export const semwrightNativeBridgeMain=bridgeEntrypoint(nativeProductionApplication);
