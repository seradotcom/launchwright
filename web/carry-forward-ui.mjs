// SPDX-License-Identifier: AGPL-3.0-only
// R70: explicitly reviewed cross-version copy into a NEW Draft only.
// Private selection/plan remain in tab memory. No auto-send or source app run.
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));
const hex=s=>typeof s==='string'&&/^[a-f0-9]{64}$/u.test(s);
export function createCarryForwardController(api){
  const selection={source_candidate_id:'',source_artifact_id:'',
    destination_target_id:'',destination_name:'Release notes'};
  let plan=null,status=null;
  const clearPlan=()=>{plan=null;status=null;};
  const clear=()=>{
    Object.assign(selection,{source_candidate_id:'',source_artifact_id:'',
      destination_target_id:'',destination_name:'Release notes'});
    clearPlan();
  };
  function choose(key,value){
    if(!Object.hasOwn(selection,key)||typeof value!=='string'||
      value.length>160)throw Error('Unknown or unbounded carry-forward selector');
    if(selection[key]===value)return;
    selection[key]=value;
    if(key==='source_candidate_id')selection.source_artifact_id='';
    clearPlan();
  }
  function render(releases,candidates,artifacts,targets,currentReleaseId){
    const releaseIds=new Set(releases.map(r=>r.id));
    const old=candidates.filter(c=>releaseIds.has(c.data.release_id)&&
      c.data.release_id!==currentReleaseId);
    const sourceCandidate=old.find(c=>c.id===selection.source_candidate_id);
    if(selection.source_candidate_id&&!sourceCandidate)choose('source_candidate_id','');
    const frozenIds=new Set(sourceCandidate?.data.manifest?.artifact_ids??[]);
    const sourceMarkdown=artifacts.filter(a=>frozenIds.has(a.id)&&
      a.data.mime?.split(';')[0].trim().toLowerCase()==='text/markdown');
    if(selection.source_artifact_id&&
      !sourceMarkdown.some(a=>a.id===selection.source_artifact_id))
      choose('source_artifact_id','');
    const targetRows=targets.filter(t=>t.data.release_id===currentReleaseId);
    if(selection.destination_target_id&&
      !targetRows.some(t=>t.id===selection.destination_target_id))
      choose('destination_target_id','');
    if(plan&&plan.destination_release_id!==currentReleaseId)clearPlan();
    const options=(rows,current,empty)=>`<option value="">${esc(empty)}</option>`+
      rows.map(row=>`<option value="${esc(row.id)}"${row.id===current?' selected':''}>${esc(row.data.name)} · ${esc(row.id)}</option>`).join('');
    const field=(id,label,html)=>`<div class="field"><label for="${id}">${esc(label)}</label>${html}</div>`;
    let html=`<section class="panel"><div class="panel-title"><h2>Historically approved Markdown → NEW build draft</h2></div><div class="panel-body"><p>Choose an approved frozen historical Candidate and Markdown Artifact from this product, plus a matching target from the <strong>currently selected draft release</strong>. Claims, evidence, permissions, approvals and artifact bytes will not be imported.</p>`;
    if(!currentReleaseId||!targetRows.length||!old.length){
      return html+`<p>First create a second draft release with its own target and an earlier frozen, editorial-approved Markdown candidate.</p></div></section>`;
    }
    html+=`<div class="carry-forward-fields">`+
      field('carry-source-candidate','Historical frozen Candidate',
        `<select id="carry-source-candidate">${options(old,selection.source_candidate_id,'Select old candidate')}</select>`)+
      field('carry-source-artifact','Frozen Markdown Artifact',
        `<select id="carry-source-artifact">${options(sourceMarkdown,selection.source_artifact_id,'Select source Markdown')}</select>`)+
      field('carry-target','New release Target',
        `<select id="carry-target">${options(targetRows,selection.destination_target_id,'Select new target')}</select>`)+
      field('carry-name','Review draft title',
        `<input id="carry-name" type="text" maxlength="115" value="${esc(selection.destination_name)}" autocomplete="off">`)+
      `</div><div class="field"><label><input type="checkbox" id="carry-rights"> I declare rights to review this historical editorial source.</label></div>`+
      `<div class="field"><label><input type="checkbox" id="carry-recheck"> I understand this is a NEW unverified draft for a new build and requires fresh human review.</label></div>`+
      `<div class="actions"><button data-action="carry-plan">Prepare source-bound plan</button><button data-action="carry-restore" class="secondary">Restore saved plan</button><button data-action="carry-clear" class="secondary">Clear selection</button></div></div></section>`;
    if(plan){
      html+=`<section class="panel"><div class="panel-title"><h2>Prepared editorial handoff — no draft written yet</h2></div><div class="panel-body"><dl class="fact-list carry-forward-facts">`+
        [['Plan SHA-256',plan.plan_sha256],
          ['Historical approved Candidate SHA-256',plan.source_candidate_sha256],
          ['Frozen Markdown SHA-256',plan.source_artifact_sha256],
          ['Source build',plan.source_build],
          ['New destination build',plan.destination_build],
          ['New review title',plan.created_name],
          ['Technical verification','UNKNOWN — all old claims/evidence/approval cleared']
        ].map(([label,value])=>`<div><dt>${esc(label)}</dt><dd><code class="carry-forward-hash">${esc(value)}</code></dd></div>`).join('')+
        `</dl><p>A draft creation requires separate full plan/Candidate hashes and the exact new build label. It will create only an editable Markdown document with an explicit re-verification banner and a declared provenance relation.</p><div class="actions"><button data-action="carry-apply">Create or reconcile private draft</button><button class="secondary" data-action="carry-inspect">Read back draft status</button><button class="secondary" data-action="carry-save">Download private plan JSON</button></div></div></section>`;
    }
    if(status){
      html+=`<section class="panel"><div class="panel-title"><h2>Native draft readback</h2></div><div class="panel-body"><p>State: <strong>${esc(status.state)}</strong>. Technical state: <strong>UNKNOWN</strong>. Nothing published.</p>`+
        (status.deliverable_id?`<p>New editable document: <code>${esc(status.deliverable_id)}</code></p>`:'')+
        (status.relation_id?`<p>Declared provenance relation: <code>${esc(status.relation_id)}</code></p>`:'')+
        `<p class="small-note">Open Deliverables on the new release to edit. The old release, evidence, Review and immutable artifacts remain unchanged.</p></div></section>`;
    }
    return html+`<div class="callout"><strong>Not an automatic reuse guarantee</strong>Copy-forward does not imply unchanged product behavior, source rights, availability, accessibility, Graph completeness or Semwright Platform authority. Review all claims and render new artifacts for the new build.</div>`;
  }
  async function prepare(releaseId,{rights,recheck}={}){
    if(!releaseId||!Object.values(selection).every(Boolean))
      throw Error('Select historical candidate, Markdown, new target and title');
    if(rights!==true||recheck!==true)
      throw Error('Both historical rights and fresh editorial-review declarations are required');
    const result=await api.planCarryForward({
      ...selection,destination_release_id:releaseId,
      acknowledge_historical_rights:true,
      acknowledge_editorial_recheck:true
    });
    if(!hex(result.plan_sha256))throw Error('No source-bound plan SHA-256 was returned');
    plan=result;status=null;return plan;
  }
  async function restore(saved){
    if(!saved||saved.schema_version!=='launchwright-release-carry-forward-plan/1'||
      !hex(saved.plan_sha256)||!hex(saved.source_candidate_sha256))
      throw Error('A complete original R70 plan is required');
    const readback=await api.inspectCarryForward(saved);
    Object.assign(selection,{
      source_candidate_id:saved.source_candidate_id,
      source_artifact_id:saved.source_artifact_id,
      destination_target_id:saved.destination_target_id,
      destination_name:saved.destination_name
    });
    plan=saved;status=readback;return readback;
  }
  async function inspect(){
    if(!plan)throw Error('Prepare or restore the original plan');
    status=await api.inspectCarryForward(plan);return status;
  }
  async function apply(confirmations){
    if(!plan)throw Error('Prepare or restore the exact carry-forward plan');
    if(confirmations?.acknowledge_create_draft!==true)
      throw Error('Fresh explicit editorial draft creation consent required');
    const result=await api.applyCarryForward(plan,confirmations);
    status=await api.inspectCarryForward(plan);
    if(status.state!=='DRAFT_READY'||
      status.deliverable_id!==result.deliverable_id)
      throw Error('Native carry-forward draft cannot be read back exactly');
    return result;
  }
  function downloadPlan(){
    if(!plan)throw Error('Prepare the exact source-bound plan');
    return JSON.stringify(plan,null,2)+'\n';
  }
  return{selection,choose,render,prepare,restore,inspect,apply,downloadPlan,clear,
    get plan(){return plan;},get status(){return status;}};
}
