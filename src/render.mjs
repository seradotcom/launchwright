// SPDX-License-Identifier: AGPL-3.0-only
import { requireCondition as ensure } from '@semwright/native-sdk';
import { validateCaptions } from './contracts.mjs';
export const escapeHtml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stamp=ms=>`${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`;
export function renderText(deliverable,target,release) {
  const d=deliverable.data; let content,mime,extension;
  const header=`${d.name}\nRelease: ${release.data.name} · build ${release.data.build}\nLocale: ${target.data.editorial_locale}\nDRAFT — editorial output; not evidence of product behavior.\n`;
  if(d.format==='html') {
    const rtl=/^(ar|he|fa|ur)(-|$)/.test(target.data.editorial_locale);
    content=`<!doctype html><html lang="${escapeHtml(target.data.editorial_locale)}" dir="${rtl?'rtl':'ltr'}"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'"><title>${escapeHtml(d.name)}</title><style>body{font:18px/1.65 system-ui;max-width:75ch;margin:4rem auto;padding:1.5rem}pre{white-space:pre-wrap;font:inherit}aside{border:1px solid;padding:1rem}</style><main><aside>${escapeHtml(header)}</aside><h1>${escapeHtml(d.name)}</h1><pre>${escapeHtml(d.content)}</pre></main></html>`;
    mime='text/html; charset=utf-8';extension='html';
  }else if(d.format==='json'){
    content=JSON.stringify({schema_version:'launchwright-editorial-export/1',draft:true,release:{id:release.id,version:release.version,build:release.data.build},target:target.data,deliverable:d},null,2)+'\n';mime='application/json';extension='json';
  }else if(d.format==='vtt'){
    validateCaptions(d.captions??[]);ensure(d.captions?.length,'VTT export requires timed cues');
    content='WEBVTT\n\nNOTE Editorial cues. Alignment with rendered media is not verified.\n\n'+d.captions.map((c,i)=>`${i+1}\n${stamp(c.start_ms)} --> ${stamp(c.end_ms)}\n${c.text.replaceAll('&','&amp;').replaceAll('<','&lt;')}\n`).join('\n');mime='text/vtt';extension='vtt';
  }else if(d.format==='email'){
    content=`Subject: ${d.name}\nContent-Type: text/plain; charset=utf-8\nX-Launchwright-State: draft-not-sent\n\n${header}\n${d.content}\n`;mime='text/plain; charset=utf-8';extension='eml';
  }else {content=`# ${d.name}\n\n> ${header.replaceAll('\n','\n> ')}\n\n${d.content}\n`;mime='text/markdown; charset=utf-8';extension='md';}
  return {bytes:Buffer.from(content),mime,extension};
}
