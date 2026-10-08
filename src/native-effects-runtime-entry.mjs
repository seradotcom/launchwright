// SPDX-License-Identifier: AGPL-3.0-only
import {bridgeEntrypoint} from '@semwright/native-sdk';
import {EffectsRuntimeNativeApplication} from './native-effects-runtime-app.mjs';
export const nativeEffectsRuntimeApplication=(paths,readOnly)=>new EffectsRuntimeNativeApplication(paths.data_root,{readOnly,effectsReceiptRoot:paths.output_root});
export const semwrightNativeBridgeMain=bridgeEntrypoint(nativeEffectsRuntimeApplication);
