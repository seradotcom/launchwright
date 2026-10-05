// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import { object, text, integer, requireCondition as ensure, exactRequestDigest, validateValue } from '@semwright/native-sdk';
export const APP_VERSION = '0.2.0-dev.2';
export const RESOURCE = 'launchwright:workspace';
const words=s=>s.split(' ');
export const KINDS = words('product build release source target feature availability anchor scenario claim copy_block release_contract relation evidence deliverable document proposal glossary font_profile translation extension_contract artifact bundle candidate review delivery channel_attempt withdrawal binding template channel_profile impact_proposal work tombstone');
export const EDITABLE = words('product build release source target feature availability anchor scenario claim copy_block release_contract deliverable binding template channel_profile glossary font_profile');
export const CLASSES = words('actual demo sanitized editorial generated imported');
export const FORMATS = words('markdown html json email vtt');
export const RIGHTS = words('owned licensed unknown restricted');
export const STATES = words('PASS FAIL UNKNOWN');
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
export function choice(v, values) { ensure(values.includes(v), 'Unsupported value'); return v; }
const timestamp=v=>{str(v,64);ensure(Number.isFinite(Date.parse(v)),'Invalid timestamp');};
const timeWindow=d=>{for(const k of ['valid_from','valid_until'])if(d[k])timestamp(d[k]);if(d.valid_from&&d.valid_until)ensure(Date.parse(d.valid_until)>Date.parse(d.valid_from),'Invalid time window');};
export function locale(v) { str(v, 40); ensure(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(v), 'Expected BCP-47 locale'); return v; }
export function sha(v) { ensure(typeof v === 'string' && /^[a-f0-9]{64}$/.test(v), 'Invalid SHA-256'); return v; }
export function inputObject(v, fields, required = fields) { validateValue(v); return object(v, fields, required); }
export function noSecrets(value) {
  for (const [k, v] of Object.entries(value)) {
    ensure(!/^(password|authorization|cookie|access_token|refresh_token|private_key|bearer|api_key)$/i.test(k), 'Secret field rejected');
    if (v && typeof v === 'object') noSecrets(v);
    if (typeof v === 'string') ensure(!/-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----|\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}/.test(v), 'Credential-like data rejected');
  }
}
// These are Launchwright's application schemas, not invented Semwright APIs.
export function validateEntity(kind, raw) {
  ensure(EDITABLE.includes(kind), 'Dedicated operation required');
  validateValue(raw); noSecrets(raw); const d = structuredClone(raw);
  const encoded = {
    product:'name description?',
    build:'product_id name artifact_digest version_label? source_revision? observed_at? notes?',
    release:'product_id name build build_id? status? notes?',
    source:'product_id name type locator build build_id? coverage purpose? approval? observed_at?',
    target:'release_id name ui_locale editorial_locale audio_locale? role plan region flags viewport',
    feature:'release_id name key description? status',
    availability:'release_id name feature_id target_id state valid_from? valid_until? basis',
    anchor:'release_id name source_id target_id strategy value expected_count',
    scenario:'release_id name source_id target_id steps anchors readiness version_label? reset_strategy? effects?',
    claim:'release_id name text target_id category evidence_ids subject? scope? owner? valid_from? valid_until? unit? currency? availability_id?',
    copy_block:'release_id name target_id claim_id locale content owner',
    release_contract:'release_id name required_claim_ids optional_claim_ids required_deliverable_ids',
    deliverable:'release_id name target_id format content claim_ids copy_block_ids? source_ids captions?',
    binding:'release_id name mode deliverable_id pinned_artifact_id?',
    template:'product_id name format content parameters',
    channel_profile:'product_id name profile_version channel delivery_mode formats locales max_artifact_bytes idempotency withdrawal provenance reviewed_at',
    glossary:'product_id name source_locale target_locale terms fallback_policy reviewed_at',
    font_profile:'product_id name profile_version locales font_family_ref coverage rights license_ref asset_included reviewed_at',
  }[kind].split(' ');
  const allowed=encoded.map(k=>k.endsWith('?')?k.slice(0,-1):k),required=encoded.filter(k=>!k.endsWith('?'));
  object(d, allowed, required);
  str(d.name, 160);
  for (const k of ['product_id','build_id','release_id','source_id','target_id','feature_id','availability_id','claim_id','deliverable_id','pinned_artifact_id']) if (d[k]) idText(d[k]);
  for (const k of ['claim_ids','copy_block_ids','source_ids','evidence_ids','required_claim_ids','optional_claim_ids','required_deliverable_ids']) if (d[k]) { array(d[k]); d[k].forEach(idText); ensure(new Set(d[k]).size === d[k].length, 'Duplicate references'); }
  if ('description' in d) lines(d.description, 6000);
  if ('content' in d) lines(d.content);
  if ('text' in d) lines(d.text, 6000);
  if ('build' in d) str(d.build, 256);
  if (kind === 'build') {
    sha(d.artifact_digest); if (d.version_label) str(d.version_label,128); if (d.source_revision) str(d.source_revision,256); if (d.notes) lines(d.notes);
    if (d.observed_at) timestamp(d.observed_at);
  }
  if (kind === 'release') { if (d.status) choice(d.status, ['draft','active','lts','archived']); if (d.notes) lines(d.notes); }
  if (kind === 'source') {
    choice(d.type, ['web','cli','mobile-import','godot','document']); choice(d.coverage, ['declared','partial','unknown']);
    str(d.locator, 2048); if (d.purpose) lines(d.purpose,2000); if (d.approval) choice(d.approval,['approved','pending','denied']);
    if (d.observed_at) timestamp(d.observed_at);
    if (/^https?:/i.test(d.locator)) {
      let u; try { u = new URL(d.locator); } catch { ensure(false, 'Invalid source URL'); }
      ensure(!u.username && !u.password && !u.search && !u.hash, 'Unsafe source URL');
      if (!['127.0.0.1','localhost','[::1]','::1'].includes(u.hostname)) ensure(d.approval==='approved' && !!d.purpose, 'Source approval required', 'PermissionDenied');
    }
  }
  if (kind === 'target') {
    for (const k of ['ui_locale','editorial_locale','audio_locale']) if (d[k]) locale(d[k]);
    for (const k of ['role','plan','region']) str(d[k], 100);
    object(d.flags); ensure(Object.keys(d.flags).length <= 32 && Object.entries(d.flags).every(([k,v]) => /^[a-zA-Z][\w.-]{0,63}$/.test(k) && typeof v === 'boolean'), 'Invalid flags');
    object(d.viewport, ['width','height','scale_milli'], ['width','height','scale_milli']);
    integer(d.viewport.width, 240, 7680); integer(d.viewport.height, 240, 7680); integer(d.viewport.scale_milli, 500, 4000);
  }
  if (kind === 'feature') { str(d.key,128); ensure(/^[a-z][a-z0-9_.-]{0,127}$/.test(d.key),'Invalid feature key'); choice(d.status,['active','beta','disabled','deprecated']); if(d.description)lines(d.description,6000); }
  if (kind === 'availability') {
    choice(d.state,['ga','beta','unavailable','unknown']); choice(d.basis,['declared','imported','observed']);
    timeWindow(d);
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
    timeWindow(d);
  }
  if (kind === 'copy_block') { locale(d.locale); lines(d.content,24000); choice(d.owner,['human','managed']); }
  if (kind === 'release_contract') {
    ensure(!d.required_claim_ids.some(id=>d.optional_claim_ids.includes(id)),'Claim requirement conflict');
    ensure(d.required_claim_ids.length+d.optional_claim_ids.length+d.required_deliverable_ids.length>0,'Empty release contract');
  }
  if (kind === 'deliverable' || kind === 'template') choice(d.format, FORMATS);
  if (kind === 'binding') { choice(d.mode, ['rolling','pinned','lts']); ensure(d.mode === 'rolling' || !!d.pinned_artifact_id, 'Pinned artifact required'); }
  if (kind === 'template') {
    array(d.parameters,16).forEach(p => { str(p,64); ensure(/^[a-z][a-z0-9_]*$/.test(p), 'Invalid parameter'); });
    ensure(new Set(d.parameters).size === d.parameters.length, 'Duplicate parameter');
    ensure(d.format !== 'vtt', 'VTT template unsupported');
  }
  if (kind === 'channel_profile') {
    str(d.profile_version,64); choice(d.channel,['private-bundle','static-site','docs-repo','review-portal','email-draft','social-draft','app-store-package','play-store-package','cms']);
    choice(d.delivery_mode,['export','upload','publish']); array(d.formats,32).forEach(v=>{str(v,32);ensure(/^[a-z0-9][a-z0-9._+-]{0,31}$/.test(v),'Invalid channel format');}); ensure(new Set(d.formats).size===d.formats.length,'Duplicate channel format');
    array(d.locales,64).forEach(locale); ensure(new Set(d.locales).size===d.locales.length,'Duplicate channel locale'); integer(d.max_artifact_bytes,1,1024*1024*1024);
    choice(d.idempotency,['native','reconcile','none']); choice(d.withdrawal,['supported','corrective-only','unknown']); lines(d.provenance,4000); timestamp(d.reviewed_at);
  }
  if(kind==='glossary'){
    locale(d.source_locale);locale(d.target_locale);choice(d.fallback_policy,['block','manual-only','source-with-warning']);timestamp(d.reviewed_at);array(d.terms,128);
    const seen=new Set();for(const term of d.terms){object(term,['source','target','case_sensitive'],['source','target']);str(term.source,160);str(term.target,160);if(term.case_sensitive!==undefined)ensure(typeof term.case_sensitive==='boolean','Glossary case_sensitive must be boolean');const key=(term.case_sensitive?term.source:term.source.toLocaleLowerCase())+'\u0000'+term.target;ensure(!seen.has(key),'Duplicate glossary term');seen.add(key);}
  }
  if(kind==='font_profile'){
    str(d.profile_version,64);array(d.locales,64).forEach(locale);ensure(new Set(d.locales).size===d.locales.length,'Duplicate font locale');str(d.font_family_ref,256);choice(d.coverage,['declared','subset-known','unknown']);choice(d.rights,RIGHTS);str(d.license_ref,512);ensure(d.asset_included===false,'Font binaries are never embedded by FontProfile');timestamp(d.reviewed_at);
  }
  if (d.captions !== undefined) validateCaptions(d.captions);
  return d;
}
export function validateCaptions(cues) {
  let end = 0;
  array(cues,128).forEach(c => { object(c, ['start_ms','end_ms','text'], ['start_ms','end_ms','text']); integer(c.start_ms,0,86400000); integer(c.end_ms,1,86400000); ensure(c.start_ms >= end && c.end_ms > c.start_ms, 'Invalid caption timing'); str(c.text,1000); ensure(!c.text.includes('-->'), 'Invalid caption text'); end = c.end_ms; });
}
const scopeGroups={
  read:'workspace.describe workspace.doctor workspace.negotiate resource.get events.list history.get history.list history.diff release.coverage release.impact release.channels channel.inspect anchor.assess artifact.read candidate.inspect document.inspect translation.inspect extension.describe extension.negotiate',
  edit:'entity.create entity.update entity.retire relation.record impact.plan evidence.import deliverable.render candidate.freeze candidate.export_bundle channel.prepare channel.withdraw_plan template.instantiate document.create document.propose document.edit_human document.render translation.create translation.edit_human translation.rebase translation.render extension.register extension.retire work.prepare work.claim work.complete work.mark_unknown',
  review:'candidate.review document.resolve translation.review',publish:'candidate.deliver_private channel.claim channel.mark_unknown channel.complete channel.reconcile',admin:'workspace.rotate_epoch',
};
export const OPERATION_SCOPES = Object.freeze(Object.fromEntries(Object.entries(scopeGroups).flatMap(([scope,names])=>words(names).map(name=>[name,scope]))));
