// SPDX-License-Identifier: AGPL-3.0-only
import { CORE_NATIVE_OPERATIONS } from './native-core-app.mjs';
import { PRODUCTION_NATIVE_OPERATIONS } from './native-production-app.mjs';
import { REVIEW_NATIVE_OPERATIONS } from './native-review-app.mjs';
import { INTEGRATIONS_NATIVE_OPERATIONS } from './native-integrations-app.mjs';
import { WORK_NATIVE_OPERATIONS } from './native-work-app.mjs';
import { MEDIA_NATIVE_OPERATIONS } from './native-media-app.mjs';
import { PUBLISH_NATIVE_OPERATIONS } from './native-publish-app.mjs';
import { SOURCES_NATIVE_OPERATIONS } from './native-sources-app.mjs';
import { GRAPH_NATIVE_OPERATIONS } from './native-graph-app.mjs';

export const NATIVE_PROFILES=Object.freeze({
  core:Object.freeze({entry:'src/native-core-entry.mjs',file:'launchwright-core.cjs',operations:CORE_NATIVE_OPERATIONS}),
  sources:Object.freeze({entry:'src/native-sources-entry.mjs',file:'launchwright-sources.cjs',operations:SOURCES_NATIVE_OPERATIONS}),
  graph:Object.freeze({entry:'src/native-graph-entry.mjs',file:'launchwright-graph.cjs',operations:GRAPH_NATIVE_OPERATIONS}),
  production:Object.freeze({entry:'src/native-production-entry.mjs',file:'launchwright-production.cjs',operations:PRODUCTION_NATIVE_OPERATIONS}),
  review:Object.freeze({entry:'src/native-review-entry.mjs',file:'launchwright-review.cjs',operations:REVIEW_NATIVE_OPERATIONS}),
  integrations:Object.freeze({entry:'src/native-integrations-entry.mjs',file:'launchwright-integrations.cjs',operations:INTEGRATIONS_NATIVE_OPERATIONS}),
  work:Object.freeze({entry:'src/native-work-entry.mjs',file:'launchwright-work.cjs',operations:WORK_NATIVE_OPERATIONS}),
  media:Object.freeze({entry:'src/native-media-entry.mjs',file:'launchwright-media.cjs',operations:MEDIA_NATIVE_OPERATIONS}),
  publish:Object.freeze({entry:'src/native-publish-entry.mjs',file:'launchwright-publish.cjs',operations:PUBLISH_NATIVE_OPERATIONS})
});
export const NATIVE_PROFILE_NAMES=Object.freeze(Object.keys(NATIVE_PROFILES));
