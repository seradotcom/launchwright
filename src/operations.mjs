// SPDX-License-Identifier: AGPL-3.0-only
export const OPERATION_SCOPES=Object.freeze({
  'workspace.describe':'read','workspace.snapshot':'read','resource.get':'read','events.list':'read','history.get':'read','history.list':'read','history.diff':'read','release.coverage':'read','release.impact':'read','graph.inspect':'read','anchor.assess':'read','artifact.read':'read','candidate.inspect':'read','verification.summary':'read','channel.status':'read','localization.assess':'read','profile.matrix':'read','profile.preflight':'read','extension.discovery':'read','compatibility.negotiate':'read','compatibility.inspect':'read','mobile.inspect':'read','change.inspect':'read','media.inspect':'read','publish.inspect':'consume',
  'entity.create':'edit','entity.update':'edit','entity.retire':'edit','change.propose':'edit','change.apply':'edit','relation.record':'edit','impact.plan':'edit','graph.record':'edit','evidence.import':'edit','capture.ingest':'capture','verification.record':'review','waiver.record':'review','deliverable.render':'edit','candidate.freeze':'edit','candidate.review':'review','candidate.deliver_private':'publish','channel.package':'publish','channel.record_outcome':'publish',
  'localization.create':'edit','localization.update':'edit','extension.register':'admin','extension.retire':'admin','compatibility.lock':'admin','mobile.import':'capture','template.instantiate':'edit','media.plan':'edit','media.revise':'edit','media.output_record':'capture','media.review_record':'review',
  'publish.template_create':'edit','publish.template_update':'edit','publish.version_freeze':'publish','publish.deployment_create':'publish','publish.deployment_transition':'publish','publish.invoke_prepare':'consume','publish.export':'publish','publish.import':'edit','publish.import_rebind':'edit',
  'work.prepare':'edit','work.claim':'edit','work.complete':'edit','work.mark_unknown':'edit','workspace.rotate_epoch':'admin',
});
export const READ_OPERATIONS=Object.freeze(new Set([
  ...Object.entries(OPERATION_SCOPES).filter(([,scope])=>scope==='read').map(([name])=>name),
  'publish.inspect'
]));
