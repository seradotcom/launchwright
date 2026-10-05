// SPDX-License-Identifier: AGPL-3.0-only
import { CORE_NATIVE_OPERATIONS } from './native-core-app.mjs';
import { PRODUCTION_NATIVE_OPERATIONS } from './native-production-app.mjs';
import { REVIEW_NATIVE_OPERATIONS } from './native-review-app.mjs';
import { INTEGRATIONS_NATIVE_OPERATIONS } from './native-integrations-app.mjs';
import { WORK_NATIVE_OPERATIONS } from './native-work-app.mjs';

export const NATIVE_PROFILES=Object.freeze({
  core:Object.freeze({entry:'src/native-core-entry.mjs',file:'launchwright-core.cjs',operations:CORE_NATIVE_OPERATIONS}),
  production:Object.freeze({entry:'src/native-production-entry.mjs',file:'launchwright-production.cjs',operations:PRODUCTION_NATIVE_OPERATIONS}),
  review:Object.freeze({entry:'src/native-review-entry.mjs',file:'launchwright-review.cjs',operations:REVIEW_NATIVE_OPERATIONS}),
  integrations:Object.freeze({entry:'src/native-integrations-entry.mjs',file:'launchwright-integrations.cjs',operations:INTEGRATIONS_NATIVE_OPERATIONS}),
  work:Object.freeze({entry:'src/native-work-entry.mjs',file:'launchwright-work.cjs',operations:WORK_NATIVE_OPERATIONS})
});
export const NATIVE_PROFILE_NAMES=Object.freeze(Object.keys(NATIVE_PROFILES));
