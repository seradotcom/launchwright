// SPDX-License-Identifier: AGPL-3.0-only
import { bridgeEntrypoint } from '@semwright/native-sdk';
import { EffectsNativeApplication } from './native-effects-app.mjs';
export const nativeEffectsApplication=(paths,readOnly)=>new EffectsNativeApplication(paths.data_root,{readOnly});
export const semwrightNativeBridgeMain=bridgeEntrypoint(nativeEffectsApplication);
