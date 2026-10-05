// SPDX-License-Identifier: AGPL-3.0-only
import { object, text, integer, requireCondition as ensure, validateValue } from '@semwright/native-sdk';
import { APP_VERSION, RESOURCE, iso, digest, makeRequest } from './base.mjs';
export { APP_VERSION, RESOURCE, iso, digest, makeRequest };
export const KINDS = ['product','build','release','source','target','feature','availability','anchor','scenario','claim','copy_block','glossary','localized_copy','release_contract','relation','evidence','verification','waiver','deliverable','artifact','candidate','review','delivery','channel_profile','channel_delivery','binding','template','extension_package','compatibility_lock','impact_proposal','change_proposal','change_application','work','tombstone'];
export const EDITABLE = ['product','build','release','source','target','feature','availability','anchor','scenario','claim','copy_block','glossary','release_contract','deliverable','channel_profile','binding','template'];
export const CLASSES = ['actual','demo','sanitized','editorial','generated','imported'];
export const FORMATS = ['markdown','html','json','email','vtt'];
export const RIGHTS = ['owned','licensed','unknown','restricted'];
export const STATES = ['PASS','FAIL','UNKNOWN'];
export const idText = value => { const s = text(value, 96, 'resource ID'); ensure(/^[a-z][a-z0-9_-]{1,95}$/.test(s), 'Invalid resource ID'); return s; };
export const str = (v, max = 4000) => text(v, max, 'text');
export function lines(v, max = 24000) { ensure(typeof v === 'string' && Buffer.byteLength(v) <= max && !/[\0\u0001-\u0008\u000b\u000c\u000e-\u001f]/u.test(v), 'Invalid bounded text'); return v; }
export function array(v, max = 64) { ensure(Array.isArray(v) && v.length <= max, 'Invalid bounded list'); return v; }
export function choice(v, values) { ensure(values.includes(v), 'Value outside supported choices: ' + values.join(', ')); return v; }
export function locale(v) { str(v, 40); ensure(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(v), 'Expected BCP-47 locale'); return v; }
export function sha(v) { ensure(typeof v === 'string' && /^[a-f0-9]{64}$/.test(v), 'Invalid SHA-256'); return v; }
export function inputObject(v, fields, required = fields) { validateValue(v); return object(v, fields, required); }
export function noSecrets(value) {
  for (const [k, v] of Object.entries(value)) {
    ensure(!/^(password|authorization|cookie|access_token|refresh_token|private_key|bearer|api_key)$/i.test(k), 'Secrets are not domain data');
    if (v && typeof v === 'object') noSecrets(v);
    if (typeof v === 'string') ensure(!/-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----|\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}/.test(v), 'Credential-like data rejected');
  }
}
// These are Launchwright's application schemas, not invented Semwright APIs.
export function validateEntity(kind, raw) {
  ensure(EDITABLE.includes(kind), 'This resource can only be created through its dedicated operation');
  validateValue(raw); noSecrets(raw); const d = structuredClone(raw);
  const schemas = {
    product: [['name','description'], ['name']],
    build: [['product_id','name','artifact_digest','version_label','source_revision','observed_at','notes'], ['product_id','name','artifact_digest']],
    release: [['product_id','name','build','build_id','status','notes'], ['product_id','name','build']],
    source: [['product_id','name','type','locator','build','build_id','coverage','purpose','approval','observed_at'], ['product_id','name','type','locator','build','coverage']],
    target: [['release_id','name','ui_locale','editorial_locale','audio_locale','role','plan','region','flags','viewport'], ['release_id','name','ui_locale','editorial_locale','role','plan','region','flags','viewport']],
    feature: [['release_id','name','key','description','status'], ['release_id','name','key','status']],
    availability: [['release_id','name','feature_id','target_id','state','valid_from','valid_until','basis'], ['release_id','name','feature_id','target_id','state','basis']],
    anchor: [['release_id','name','source_id','target_id','strategy','value','expected_count'], ['release_id','name','source_id','target_id','strategy','value','expected_count']],
    scenario: [['release_id','name','source_id','target_id','steps','anchors','readiness','version_label','reset_strategy','effects'], ['release_id','name','source_id','target_id','steps','anchors','readiness']],
    claim: [['release_id','name','text','target_id','category','evidence_ids','subject','scope','owner','valid_from','valid_until','unit','currency','availability_id'], ['release_id','name','text','target_id','category','evidence_ids']],
    copy_block: [['release_id','name','target_id','claim_id','locale','content','owner'], ['release_id','name','target_id','claim_id','locale','content','owner']],
    glossary: [['product_id','name','source_locale','target_locale','version_label','terms','owner','status'], ['product_id','name','source_locale','target_locale','version_label','terms','owner','status']],
    release_contract: [['release_id','name','required_claim_ids','optional_claim_ids','required_deliverable_ids'], ['release_id','name','required_claim_ids','optional_claim_ids','required_deliverable_ids']],
    deliverable: [['release_id','name','target_id','format','content','claim_ids','copy_block_ids','source_ids','captions'], ['release_id','name','target_id','format','content','claim_ids','source_ids']],
    channel_profile: [['product_id','name','channel','profile_version','destination_class','requirements','source','effective_at','idempotency'], ['product_id','name','channel','profile_version','destination_class','requirements','source','effective_at','idempotency']],
    binding: [['release_id','name','mode','deliverable_id','pinned_artifact_id'], ['release_id','name','mode','deliverable_id']],
    template: [['product_id','name','format','content','parameters'], ['product_id','name','format','content','parameters']],
  };
  object(d, ...schemas[kind]);
  str(d.name, 160);
  for (const k of ['product_id','build_id','release_id','source_id','target_id','feature_id','availability_id','claim_id','deliverable_id','pinned_artifact_id']) if (d[k]) idText(d[k]);
  for (const k of ['claim_ids','copy_block_ids','source_ids','evidence_ids','required_claim_ids','optional_claim_ids','required_deliverable_ids']) if (d[k]) { array(d[k]); d[k].forEach(idText); ensure(new Set(d[k]).size === d[k].length, 'Duplicate references'); }
  if ('description' in d) lines(d.description, 6000);
  if ('content' in d) lines(d.content);
  if ('text' in d) lines(d.text, 6000);
  if ('build' in d) str(d.build, 256);
  if (kind === 'build') {
    sha(d.artifact_digest); if (d.version_label) str(d.version_label,128); if (d.source_revision) str(d.source_revision,256); if (d.notes) lines(d.notes);
    if (d.observed_at) { str(d.observed_at,64); ensure(Number.isFinite(Date.parse(d.observed_at)), 'Build observed_at must be an ISO timestamp'); }
  }
  if (kind === 'release') { if (d.status) choice(d.status, ['draft','active','lts','archived']); if (d.notes) lines(d.notes); }
  if (kind === 'source') {
    choice(d.type, ['web','cli','mobile-import','godot','document']); choice(d.coverage, ['declared','partial','unknown']);
    str(d.locator, 2048); if (d.purpose) lines(d.purpose,2000); if (d.approval) choice(d.approval,['approved','pending','denied']);
    if (d.observed_at) { str(d.observed_at,64); ensure(Number.isFinite(Date.parse(d.observed_at)), 'Source observed_at must be an ISO timestamp'); }
    if (/^https?:/i.test(d.locator)) {
      let u; try { u = new URL(d.locator); } catch { ensure(false, 'Invalid source URL'); }
      ensure(!u.username && !u.password && !u.search && !u.hash, 'Source URLs must not carry credentials, query secrets or fragments');
      if (!['127.0.0.1','localhost','[::1]','::1'].includes(u.hostname)) ensure(d.approval==='approved' && !!d.purpose, 'External source requires approved purpose before navigation', 'PermissionDenied');
    }
  }
  if (kind === 'target') {
    for (const k of ['ui_locale','editorial_locale','audio_locale']) if (d[k]) locale(d[k]);
    for (const k of ['role','plan','region']) str(d[k], 100);
    object(d.flags); ensure(Object.keys(d.flags).length <= 32 && Object.entries(d.flags).every(([k,v]) => /^[a-zA-Z][\w.-]{0,63}$/.test(k) && typeof v === 'boolean'), 'Flags must be explicit booleans');
    object(d.viewport, ['width','height','scale_milli'], ['width','height','scale_milli']);
    integer(d.viewport.width, 240, 7680); integer(d.viewport.height, 240, 7680); integer(d.viewport.scale_milli, 500, 4000);
  }
  if (kind === 'feature') { str(d.key,128); ensure(/^[a-z][a-z0-9_.-]{0,127}$/.test(d.key),'Invalid feature key'); choice(d.status,['active','beta','disabled','deprecated']); if(d.description)lines(d.description,6000); }
  if (kind === 'availability') {
    choice(d.state,['ga','beta','unavailable','unknown']); choice(d.basis,['declared','imported','observed']);
    for (const k of ['valid_from','valid_until']) if (d[k]) { str(d[k],64); ensure(Number.isFinite(Date.parse(d[k])), 'Availability validity must use ISO timestamps'); }
    if (d.valid_from&&d.valid_until) ensure(Date.parse(d.valid_until)>Date.parse(d.valid_from),'Availability validity window is reversed');
  }
  if (kind === 'anchor') { choice(d.strategy,['aria','text','testid','cli-match','semantic']); str(d.value,512); integer(d.expected_count,1,1); }
  if (kind === 'scenario') {
    choice(d.readiness, ['declared','needs-validation']);
    if(d.version_label)str(d.version_label,96); if(d.reset_strategy)choice(d.reset_strategy,['none','fixture-reset','isolated-context','operator-reset']);
    if(d.effects){array(d.effects,32).forEach(e=>{object(e,['kind','scope'],['kind','scope']);str(e.kind,96);str(e.scope,256);});}
    array(d.steps, 32).forEach(s => { object(s, ['action','anchor','value'], ['action','anchor']); choice(s.action, ['navigate','click','type','assert']); str(s.anchor, 256); if (s.value !== undefined) str(s.value, 2000); });
    array(d.anchors, 32).forEach(a => { object(a, ['name','role','label','expected_count'], ['name','role','label','expected_count']); str(a.name,128); str(a.role,64); str(a.label,256); integer(a.expected_count,1,1); });
  }
  if (kind === 'claim') {
    choice(d.category, ['feature','availability','price','instruction','editorial']);
    for(const k of ['subject','scope','owner','unit','currency'])if(d[k])str(d[k],256);
    for(const k of ['valid_from','valid_until'])if(d[k]){str(d[k],64);ensure(Number.isFinite(Date.parse(d[k])),'Claim validity must use ISO timestamps');}
    if(d.valid_from&&d.valid_until)ensure(Date.parse(d.valid_until)>Date.parse(d.valid_from),'Claim validity window is reversed');
  }
  if (kind === 'copy_block') { locale(d.locale); lines(d.content,24000); choice(d.owner,['human','managed']); }
  if (kind === 'glossary') {
    locale(d.source_locale); locale(d.target_locale); ensure(d.source_locale!==d.target_locale,'Glossary locales must differ'); str(d.version_label,96); choice(d.owner,['human','managed']); choice(d.status,['active','deprecated']);
    array(d.terms,512).forEach(term=>{object(term,['source','target','critical','notes'],['source','target','critical']);str(term.source,256);str(term.target,256);ensure(typeof term.critical==='boolean','Glossary critical must be boolean');if(term.notes)lines(term.notes,1000);});
    ensure(new Set(d.terms.map(term=>term.source.toLocaleLowerCase())).size===d.terms.length,'Duplicate glossary source term');
  }
  if (kind === 'release_contract') {
    ensure(!d.required_claim_ids.some(id=>d.optional_claim_ids.includes(id)),'A claim cannot be both required and optional');
    ensure(d.required_claim_ids.length+d.optional_claim_ids.length+d.required_deliverable_ids.length>0,'Release contract cannot be empty');
  }
  if (kind === 'deliverable' || kind === 'template') choice(d.format, FORMATS);
  if (kind === 'channel_profile') {
    str(d.channel,96); str(d.profile_version,96); choice(d.destination_class,['private','external-draft','public']);
    validateValue(d.requirements); ensure(d.requirements && typeof d.requirements === 'object' && !Array.isArray(d.requirements),'Channel requirements must be an object');
    str(d.source,2048); str(d.effective_at,64); ensure(Number.isFinite(Date.parse(d.effective_at)),'Channel profile effective_at must be an ISO timestamp');
    choice(d.idempotency,['safe','recover-first','unsafe']);
  }
  if (kind === 'binding') { choice(d.mode, ['rolling','pinned','lts']); ensure(d.mode === 'rolling' || !!d.pinned_artifact_id, 'Historical bindings require an immutable artifact'); }
  if (kind === 'template') {
    array(d.parameters,16).forEach(p => { str(p,64); ensure(/^[a-z][a-z0-9_]*$/.test(p), 'Invalid parameter'); });
    ensure(new Set(d.parameters).size === d.parameters.length, 'Duplicate parameter');
    ensure(d.format !== 'vtt', 'Caption templates require a media time adapter');
  }
  if (d.captions !== undefined) validateCaptions(d.captions);
  return d;
}
export function validateCaptions(cues) {
  let end = 0;
  array(cues,128).forEach(c => { object(c, ['start_ms','end_ms','text'], ['start_ms','end_ms','text']); integer(c.start_ms,0,86400000); integer(c.end_ms,1,86400000); ensure(c.start_ms >= end && c.end_ms > c.start_ms, 'Captions overlap or have invalid timing'); str(c.text,1000); ensure(!c.text.includes('-->'), 'Caption text contains a timing delimiter'); end = c.end_ms; });
}
export const OPERATION_SCOPES = Object.freeze({
  'workspace.describe':'read','workspace.snapshot':'read','resource.get':'read','events.list':'read','release.coverage':'read','release.impact':'read','anchor.assess':'read','artifact.read':'read','candidate.inspect':'read','verification.summary':'read','channel.status':'read','localization.assess':'read','profile.matrix':'read','profile.preflight':'read','extension.discovery':'read','compatibility.negotiate':'read','compatibility.inspect':'read','change.inspect':'read',
  'entity.create':'edit','entity.update':'edit','entity.retire':'edit','change.propose':'edit','change.apply':'edit','relation.record':'edit','impact.plan':'edit','evidence.import':'edit','capture.ingest':'capture','verification.record':'review','waiver.record':'review','deliverable.render':'edit','candidate.freeze':'edit','candidate.review':'review','candidate.deliver_private':'publish','channel.package':'publish','channel.record_outcome':'publish',
  'localization.create':'edit','localization.update':'edit','extension.register':'admin','extension.retire':'admin','compatibility.lock':'admin','template.instantiate':'edit','work.prepare':'edit','work.claim':'edit','work.complete':'edit','work.mark_unknown':'edit','workspace.rotate_epoch':'admin',
});
