// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import { object, text, integer, requireCondition as ensure, exactRequestDigest, validateValue } from '@semwright/native-sdk';
export const APP_VERSION = '0.1.0-dev.1';
export const RESOURCE = 'launchwright:workspace';
export const KINDS = ['product','release','source','target','scenario','claim','evidence','deliverable','artifact','candidate','review','delivery','binding','template','work'];
export const EDITABLE = ['product','release','source','target','scenario','claim','deliverable','binding','template'];
export const CLASSES = ['actual','demo','sanitized','editorial','generated','imported'];
export const FORMATS = ['markdown','html','json','email','vtt'];
export const RIGHTS = ['owned','licensed','unknown','restricted'];
export const STATES = ['PASS','FAIL','UNKNOWN'];
export const iso = () => new Date().toISOString();
export const digest = (domain, value) => exactRequestDigest('launchwright/' + domain + '/1', value);
export function makeRequest(operation, input, expected, epoch = 0, key = randomUUID()) {
  const request = { resource: RESOURCE, epoch, key,
    request_sha256: digest('request', { app_version: APP_VERSION, operation, input, expected, epoch, key }) };
  return { request, input };
}
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
    release: [['product_id','name','build','status','notes'], ['product_id','name','build']],
    source: [['product_id','name','type','locator','build','coverage'], ['product_id','name','type','locator','build','coverage']],
    target: [['release_id','name','ui_locale','editorial_locale','audio_locale','role','plan','region','flags','viewport'], ['release_id','name','ui_locale','editorial_locale','role','plan','region','flags','viewport']],
    scenario: [['release_id','name','source_id','target_id','steps','anchors','readiness'], ['release_id','name','source_id','target_id','steps','anchors','readiness']],
    claim: [['release_id','name','text','target_id','category','evidence_ids'], ['release_id','name','text','target_id','category','evidence_ids']],
    deliverable: [['release_id','name','target_id','format','content','claim_ids','source_ids','captions'], ['release_id','name','target_id','format','content','claim_ids','source_ids']],
    binding: [['release_id','name','mode','deliverable_id','pinned_artifact_id'], ['release_id','name','mode','deliverable_id']],
    template: [['product_id','name','format','content','parameters'], ['product_id','name','format','content','parameters']],
  };
  object(d, ...schemas[kind]);
  str(d.name, 160);
  for (const k of ['product_id','release_id','source_id','target_id','deliverable_id','pinned_artifact_id']) if (d[k]) idText(d[k]);
  for (const k of ['claim_ids','source_ids','evidence_ids']) if (d[k]) { array(d[k]); d[k].forEach(idText); ensure(new Set(d[k]).size === d[k].length, 'Duplicate references'); }
  if ('description' in d) lines(d.description, 6000);
  if ('content' in d) lines(d.content);
  if ('text' in d) lines(d.text, 6000);
  if ('build' in d) str(d.build, 256);
  if (kind === 'release') { if (d.status) choice(d.status, ['draft','active','lts','archived']); if (d.notes) lines(d.notes); }
  if (kind === 'source') {
    choice(d.type, ['web','cli','mobile-import','godot','document']); choice(d.coverage, ['declared','partial','unknown']);
    str(d.locator, 2048);
    if (/^https?:/i.test(d.locator)) { let u; try { u = new URL(d.locator); } catch { ensure(false, 'Invalid source URL'); } ensure(!u.username && !u.password && !u.search && !u.hash, 'Source URLs must not carry credentials, query secrets or fragments'); }
  }
  if (kind === 'target') {
    for (const k of ['ui_locale','editorial_locale','audio_locale']) if (d[k]) locale(d[k]);
    for (const k of ['role','plan','region']) str(d[k], 100);
    object(d.flags); ensure(Object.keys(d.flags).length <= 32 && Object.entries(d.flags).every(([k,v]) => /^[a-zA-Z][\w.-]{0,63}$/.test(k) && typeof v === 'boolean'), 'Flags must be explicit booleans');
    object(d.viewport, ['width','height','scale_milli'], ['width','height','scale_milli']);
    integer(d.viewport.width, 240, 7680); integer(d.viewport.height, 240, 7680); integer(d.viewport.scale_milli, 500, 4000);
  }
  if (kind === 'scenario') {
    choice(d.readiness, ['declared','needs-validation']);
    array(d.steps, 32).forEach(s => { object(s, ['action','anchor','value'], ['action','anchor']); choice(s.action, ['navigate','click','type','assert']); str(s.anchor, 256); if (s.value !== undefined) str(s.value, 2000); });
    array(d.anchors, 32).forEach(a => { object(a, ['name','role','label','expected_count'], ['name','role','label','expected_count']); str(a.name,128); str(a.role,64); str(a.label,256); integer(a.expected_count,1,1); });
  }
  if (kind === 'claim') choice(d.category, ['feature','availability','price','instruction','editorial']);
  if (kind === 'deliverable' || kind === 'template') choice(d.format, FORMATS);
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
  'workspace.describe':'read','resource.get':'read','events.list':'read','release.coverage':'read','release.impact':'read','artifact.read':'read','candidate.inspect':'read',
  'entity.create':'edit','entity.update':'edit','evidence.import':'edit','deliverable.render':'edit','candidate.freeze':'edit','candidate.review':'review','candidate.deliver_private':'publish',
  'template.instantiate':'edit','work.prepare':'edit','work.claim':'edit','work.complete':'edit','work.mark_unknown':'edit','workspace.rotate_epoch':'admin',
});
