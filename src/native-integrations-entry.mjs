// SPDX-License-Identifier: AGPL-3.0-only
import { bridgeEntrypoint } from '@semwright/native-sdk';
import { IntegrationsNativeApplication } from './native-integrations-app.mjs';
export const nativeIntegrationsApplication=(paths,readOnly)=>new IntegrationsNativeApplication(paths.data_root,{readOnly});
export const semwrightNativeBridgeMain=bridgeEntrypoint(nativeIntegrationsApplication);
