// SPDX-License-Identifier: AGPL-3.0-only
// R67 in-memory, operator-driven continuity UI. Never stores private plans in
// localStorage, silently retries a POST, or links to unauthenticated files.
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));
const validHash=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);

export function createContinuityController(api){
  const selection={
    before_release_id:'',after_release_id:'',
    before_candidate_id:'',after_candidate_id:''
  };
  let plan=null,receipt=null,status=null;
  const clear=()=>{plan=null;receipt=null;status=null;};
  const choose=(key,value)=>{
    if(!Object.hasOwn(selection,key))throw Error('Unsupported continuity selector');
    if(typeof value!=='string'||value.length>160)throw Error('Invalid continuity choice');
    if(selection[key]===value)return;
    selection[key]=value;
    if(key==='before_release_id')selection.before_candidate_id='';
    if(key==='after_release_id')selection.after_candidate_id='';
    clear();
  };
  function render(releases,candidates){
    // Scope every selectable record to the CURRENT product, never another
    // product or a candidate from the wrong release.
    const releaseIds=new Set(releases.map(r=>r.id));
    for(const field of ['before_release_id','after_release_id']){
      if(selection[field]&&!releaseIds.has(selection[field]))choose(field,'');
    }
    const candidatesFor=id=>candidates.filter(c=>c.data.release_id===id);
    for(const [field,releaseField] of [
      ['before_candidate_id','before_release_id'],
      ['after_candidate_id','after_release_id']
    ])if(selection[field]&&!candidatesFor(selection[releaseField]).some(c=>c.id===selection[field]))
      choose(field,'');
    const options=(items,value,placeholder)=>`<option value="">${escapeHtml(placeholder)}</option>`+
      items.map(item=>`<option value="${escapeHtml(item.id)}"${value===item.id?' selected':''}>${escapeHtml(item.data.name)} · ${escapeHtml(item.id)}</option>`).join('');
    const field=(id,label,items,value,placeholder)=>`<div class="field"><label for="${id}">${escapeHtml(label)}</label><select id="${id}">${options(items,value,placeholder)}</select></div>`;
    if(releases.length<2)return`<section class="panel"><div class="panel-body"><h2>Two releases required</h2><p>Create two distinct releases of one product, render and freeze their exact candidates before comparing them.</p></div></section>`;
    let html=`<section class="panel"><div class="panel-title"><h2>Exact release comparison</h2></div><div class="panel-body"><p>Select two historical candidates. Source changes, missing bytes or ambiguous artifact identities stop the comparison; equal text never proves unchanged product behavior.</p><div class="continuity-fields">`+
      field('continuity-before-release','Earlier release',releases,selection.before_release_id,'Choose earlier release')+
      field('continuity-before-candidate','Earlier frozen candidate',candidatesFor(selection.before_release_id),selection.before_candidate_id,'Choose earlier candidate')+
      field('continuity-after-release','Later release',releases,selection.after_release_id,'Choose later release')+
      field('continuity-after-candidate','Later frozen candidate',candidatesFor(selection.after_release_id),selection.after_candidate_id,'Choose later candidate')+
      `</div><div class="field"><label><input type="checkbox" id="continuity-private-confirm"> I authorize a private local comparison only.</label></div>`+
      `<div class="field"><label><input type="checkbox" id="continuity-incomplete-confirm"> I acknowledge incomplete technical, rights, Platform and customer evidence.</label></div>`+
      `<div class="actions"><button data-action="continuity-plan">Prepare exact plan</button><button class="secondary" data-action="continuity-recover">Recover existing export by full plan SHA</button><button class="secondary" data-action="continuity-clear">Clear comparison</button></div></div></section>`;
    if(plan){
      html+=`<section class="panel"><div class="panel-title"><h2>Prepared plan — no export yet</h2></div><div class="panel-body"><dl class="fact-list">`+
        [['Plan SHA-256',plan.plan_sha256],['Before candidate SHA-256',plan.before_candidate_sha256],
          ['After candidate SHA-256',plan.after_candidate_sha256],
          ['Changed / added / removed / unchanged',`${plan.changed_artifacts} / ${plan.added_artifacts} / ${plan.removed_artifacts} / ${plan.unchanged_artifacts}`],
          ['Technical state','UNKNOWN · registered workspace records only']]
          .map(([k,v])=>`<div><dt>${escapeHtml(k)}</dt><dd><code class="continuity-hash">${escapeHtml(v)}</code></dd></div>`).join('')+
        `</dl><p>The export requires the operator to independently type all three full hashes. It never publishes or runs customer code.</p><div class="actions"><button data-action="continuity-export">Export private ZIP</button><button class="secondary" data-action="continuity-check">Check original export status</button></div></div></section>`;
    }
    if(receipt||status){
      const s=status??(receipt?{...receipt,state:'READY'}:null);
      if(s){html+=`<section class="panel"><div class="panel-title"><h2>Local recovery</h2></div><div class="panel-body"><p>Exact export state: <strong>${escapeHtml(s.state)}</strong>. External publication: <strong>never performed</strong>.</p>`;
        if(s.state==='READY'&&validHash(s.plan_sha256))html+=`<p>Verified SHA-256: <code class="continuity-hash">${escapeHtml(s.zip_sha256)}</code></p><p><a class="download-button" href="${escapeHtml(api.continuityBundleUrl(s.plan_sha256))}" download>Download private continuity ZIP</a></p>`;
        html+='</div></section>';
      }
    }
    return html+`<div class="callout"><strong>Continuity is not publication</strong>The source is Semwright Native-backed Launchwright workspace state, not a fresh product execution. No general pixel privacy, accessibility, canonical Platform authority or customer release acceptance is implied.</div>`;
  }
  async function prepare(acknowledgements){
    const payload={...selection,
      acknowledge_private_only:acknowledgements.private===true,
      acknowledge_incomplete_coverage:acknowledgements.incomplete===true};
    if(!Object.values(selection).every(Boolean))throw Error('Select both releases and their frozen candidates');
    if(!payload.acknowledge_private_only||!payload.acknowledge_incomplete_coverage)
      throw Error('Both operator acknowledgements are required');
    const result=await api.planLocalContinuity(payload);
    if(!validHash(result.plan_sha256))throw Error('Server returned no exact SHA-256 plan');
    plan=result;receipt=null;status=null;
    return plan;
  }
  async function exportPrivate(confirmations){
    if(!plan)throw Error('Prepare an exact plan first');
    if(!confirmations||confirmations.acknowledge_private_export!==true)
      throw Error('Explicit export confirmation is required');
    const response=await api.exportLocalContinuity(plan,confirmations);
    if(response.zip_sha256&&!validHash(response.zip_sha256))throw Error('Invalid export receipt');
    receipt=response;status=await api.continuityStatus(plan.plan_sha256);
    if(status.state!=='READY')throw Error('Continuity export could not be verified after the response');
    return status;
  }
  async function recover(fullHash){
    if(!validHash(fullHash))throw Error('Enter the complete plan SHA-256');
    status=await api.continuityStatus(fullHash);
    receipt=null;
    return status;
  }
  return{selection,choose,render,prepare,exportPrivate,recover,clear,
    get plan(){return plan;},get status(){return status;}};
}
