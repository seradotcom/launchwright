// SPDX-License-Identifier: AGPL-3.0-only
import { object, validateValue } from '@semwright/native-sdk';
import { idText, str, lines, array, choice, locale, noSecrets } from './contracts.mjs';

const rtlLocale=value=>/^(ar|he|fa|ur)(-|$)/i.test(value);

export function validateLocalization(raw){
  validateValue(raw);noSecrets(raw);const d=structuredClone(raw);
  object(d,['release_id','target_id','source_copy_block_id','glossary_id','name','locale','direction','fallback_policy','content','owner','status','font_refs'],['release_id','target_id','source_copy_block_id','name','locale','direction','fallback_policy','content','owner','status','font_refs']);
  for(const k of ['release_id','target_id','source_copy_block_id'])idText(d[k]);
  if(d.glossary_id)idText(d.glossary_id);
  str(d.name,160);locale(d.locale);choice(d.direction,['ltr','rtl']);choice(d.fallback_policy,['block','explicit-source']);
  lines(d.content,24000);choice(d.owner,['human','managed']);choice(d.status,['MACHINE_DRAFT','HUMAN_EDITED','REVIEWED_FOR_TARGET','BLOCKED']);
  array(d.font_refs,16).forEach(f=>{object(f,['family','rights','coverage'],['family','rights','coverage']);str(f.family,160);choice(f.rights,['owned','licensed','unknown','restricted']);choice(f.coverage,['declared','verified','unknown']);});
  return d;
}

export function expectedDirection(localeValue){return rtlLocale(localeValue)?'rtl':'ltr';}

export function assessLocalization(app,entity){
  const d=entity.data,source=app.get(d.source_copy_block_id,'copy_block'),target=app.get(d.target_id,'target'),sourceTarget=app.get(source.data.target_id,'target');
  const reasons=[],warnings=[];
  const audienceKeys=['role','plan','region'];
  if(audienceKeys.some(k=>sourceTarget.data[k]!==target.data[k])||JSON.stringify(sourceTarget.data.flags)!==JSON.stringify(target.data.flags))reasons.push('audience-context-mismatch');
  if(target.data.editorial_locale!==d.locale)reasons.push('target-editorial-locale-mismatch');
  if(source.data.locale===d.locale)warnings.push('source-and-target-locale-equal');
  if(source.version.generation!==d.source_version.generation||source.version.revision!==d.source_version.revision)reasons.push('STALE_SOURCE');
  if(expectedDirection(d.locale)!==d.direction)reasons.push('direction-mismatch');
  const sourceLength=[...source.data.content].length,targetLength=[...d.content].length;
  const expansion_permille=sourceLength?Math.round(targetLength*1000/sourceLength):0;
  let glossary=null;
  if(d.glossary_id){
    glossary=app.get(d.glossary_id,'glossary');
    if(glossary.version.generation!==d.glossary_version?.generation||glossary.version.revision!==d.glossary_version?.revision)reasons.push('STALE_GLOSSARY');
    for(const term of glossary.data.terms){
      if(term.critical&&source.data.content.toLocaleLowerCase().includes(term.source.toLocaleLowerCase())&&!d.content.toLocaleLowerCase().includes(term.target.toLocaleLowerCase()))reasons.push('critical-glossary-term-missing:'+term.source);
    }
  }
  for(const f of d.font_refs){if(!['owned','licensed'].includes(f.rights))reasons.push('font-rights-unresolved:'+f.family);if(f.coverage!=='verified')warnings.push('font-coverage-unverified:'+f.family);}
  if(d.status==='REVIEWED_FOR_TARGET'&&reasons.length)reasons.push('review-state-conflicts-with-current-inputs');
  const hardFail=reasons.some(r=>r==='direction-mismatch'||r.startsWith('critical-glossary-term-missing')||r.startsWith('font-rights-unresolved'));
  const stale=reasons.includes('STALE_SOURCE')||reasons.includes('STALE_GLOSSARY');
  return{localization_id:entity.id,locale:d.locale,direction:{declared:d.direction,expected:expectedDirection(d.locale)},source_version:d.source_version,current_source_version:source.version,glossary_version:d.glossary_version??null,current_glossary_version:glossary?.version??null,expansion_permille,fallback_policy:d.fallback_policy,status:d.status,state:hardFail?'FAIL':stale?'STALE_SOURCE':'UNKNOWN',reasons,warnings,final_layout_verified:false,professional_language_quality_verified:false};
}
