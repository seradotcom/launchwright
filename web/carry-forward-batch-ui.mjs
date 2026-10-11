// SPDX-License-Identifier: AGPL-3.0-only
// R71 selection of 2..8 independently reviewed historical Markdown sources.
// Browser memory only: no localStorage draft, implicit POST, publish or retry.
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));
const hash=s=>typeof s==='string'&&/^[a-f0-9]{64}$/u.test(s);
const matchTarget=(a,b)=>a?.name===b?.name&&
  a.ui_locale===b.ui_locale&&a.editorial_locale===b.editorial_locale&&
  a.role===b.role&&a.plan===b.plan&&a.region===b.region&&
  JSON.stringify(a.flags)===JSON.stringify(b.flags);

export function createCarryForwardBatchController(api){
  let candidateId='',plan=null,status=null;
  const chosen=new Map();
  const clearPlan=()=>{plan=null;status=null;};
  const clear=()=>{candidateId='';chosen.clear();clearPlan();};
  function chooseCandidate(id){
    if(typeof id!=='string'||id.length>160)
      throw Error('Invalid frozen historical Candidate identity');
    if(candidateId===id)return;
    candidateId=id;chosen.clear();clearPlan();
  }
  function toggle(id,checked){
    if(typeof id!=='string'||id.length>160||typeof checked!=='boolean')
      throw Error('Unknown carry-forward batch checkbox');
    if(checked)chosen.set(id,{destination_target_id:'',destination_name:''});
    else chosen.delete(id);
    clearPlan();
  }
  function update(id,key,value){
    if(!chosen.has(id)||!['destination_target_id','destination_name'].includes(key)||
      typeof value!=='string'||value.length>160)
      throw Error('Unexpected carry-forward destination selector');
    chosen.get(id)[key]=value;
    clearPlan();
  }
  function render(releases,candidates,artifacts,targets,deliverables,currentReleaseId){
    const releaseIds=new Set(releases.map(r=>r.id));
    const old=candidates.filter(c=>releaseIds.has(c.data.release_id)&&
      c.data.release_id!==currentReleaseId&&
      (c.data.manifest?.artifacts??[]).filter(a=>
        a.mime?.split(';')[0].trim().toLowerCase()==='text/markdown').length>=2);
    const eligible=new Set(old.map(c=>c.id));
    if(candidateId&&!eligible.has(candidateId))clear();
    if(plan&&plan.destination_release_id!==currentReleaseId)clearPlan();
    const candidate=old.find(c=>c.id===candidateId);
    const frozen=(candidate?.data.manifest?.artifacts??[])
      .filter(row=>row.mime?.split(';')[0].trim().toLowerCase()==='text/markdown')
      .map(row=>{
        const artifact=artifacts.find(a=>a.id===row.id),
          document=deliverables.find(d=>d.id===row.deliverable_id);
        if(!artifact||!document||document.data.claim_ids?.length||
           (document.data.copy_block_ids??[]).length)return null;
        const prior=targets.find(t=>t.id===document.data.target_id);
        if(!prior)return null;
        const matches=targets.filter(t=>
          t.data.release_id===currentReleaseId&&matchTarget(prior.data,t.data));
        return{artifact,document,matches};
      }).filter(Boolean);
    const safeIds=new Set(frozen.map(x=>x.artifact.id));
    for(const id of [...chosen.keys()])if(!safeIds.has(id))chosen.delete(id);
    const options=(rows,val,placeholder)=>`<option value="">${esc(placeholder)}</option>`+
      rows.map(row=>`<option value="${esc(row.id)}"${row.id===val?' selected':''}>${esc(row.data.name)} · ${esc(row.id)}</option>`).join('');
    const mainOptions=options(old,candidateId,'Choose historical frozen Candidate');
    let html=`<section class="panel"><div class="panel-title"><h2>Batch editorial carry-forward · 2–8 documents</h2></div><div class="panel-body"><p>Choose a prior human-approved frozen Candidate. Select only Markdown documents you have rights to reuse, map them to matching new-release Targets and review their titles. Every selected item is a NEW unverified draft. No claim, artifact or approval crosses releases.</p>`+
      `<div class="field"><label for="batch-candidate">Historical Candidate</label><select id="batch-candidate">${mainOptions}</select></div>`;
    if(candidate){
      html+=`<div class="carry-batch-rows">`;
      if(!frozen.length)html+='<p>No eligible claim-free frozen Markdown in this Candidate.</p>';
      for(const item of frozen){
        const id=item.artifact.id,entry=chosen.get(id),
          selected=Boolean(entry);
        if(entry){
          if(!entry.destination_name)
            entry.destination_name=item.document.data.name.slice(0,115);
          if(!entry.destination_target_id&&item.matches.length===1)
            entry.destination_target_id=item.matches[0].id;
        }
        html+=`<div class="carry-batch-row"><label class="carry-batch-source"><input type="checkbox" data-batch-toggle="${esc(id)}"${selected?' checked':''}> <strong>${esc(item.document.data.name)}</strong> <span class="record-id">${esc(id)}</span></label>`+
          `<p class="small-note">Historical source sha256: <code class="carry-batch-hash">${esc(item.artifact.data.sha256)}</code></p>`;
        if(selected){
          html+=`<div class="carry-forward-fields"><div class="field"><label for="batch-target-${esc(id)}">Matching new Target</label><select id="batch-target-${esc(id)}" data-batch-target="${esc(id)}">${options(item.matches,entry.destination_target_id,'Choose exact matching Target')}</select></div>`+
            `<div class="field"><label for="batch-name-${esc(id)}">New review title</label><input id="batch-name-${esc(id)}" maxlength="115" data-batch-name="${esc(id)}" autocomplete="off" value="${esc(entry.destination_name)}"></div></div>`;
        }
        html+='</div>';
      }
      html+='</div>';
    }
    html+=`<div class="field"><label><input type="checkbox" id="batch-rights"> I confirm my authorization to review the selected historical text.</label></div>`+
      `<div class="field"><label><input type="checkbox" id="batch-review"> I authorize NEW editable drafts only; all previous technical/evidence/editorial approvals remain untrusted for this build.</label></div>`+
      `<div class="actions"><button data-action="batch-plan">Prepare exact batch plan (${chosen.size})</button><button data-action="batch-load" class="secondary">Restore saved batch</button><button data-action="batch-clear" class="secondary">Clear selection</button></div></div></section>`;
    if(plan){
      html+=`<section class="panel"><div class="panel-title"><h2>Prepared multi-document plan — no workspace writes yet</h2></div><div class="panel-body"><dl class="fact-list carry-forward-facts">`+
        [['Batch plan SHA-256',plan.plan_sha256],
         ['Historical Candidate SHA-256',plan.source_candidate_sha256],
         ['New build',plan.destination_build],
         ['Documents selected',plan.document_count],
         ['Technical state','UNKNOWN — no copied approval or artifact']].map(([k,v])=>
          `<div><dt>${esc(k)}</dt><dd><code class="carry-batch-hash">${esc(v)}</code></dd></div>`).join('')+
        `</dl><div class="carry-batch-plan">`+
        plan.plans.map((item,i)=>
          `<p>${i+1}. <strong>${esc(item.destination_name)}</strong> · ${esc(item.created_name)} <span class="record-id">${esc(item.source_artifact_id)}</span> <code class="carry-batch-hash">${esc(item.source_artifact_sha256)}</code></p>`).join('')+
        `</div><p>Independently retype the full batch SHA-256, frozen Candidate SHA-256 and destination build. A process interruption can leave part of the batch committed; reconciliation must use this exact original plan.</p><div class="actions"><button data-action="batch-apply">Create / reconcile selected review drafts</button><button data-action="batch-inspect" class="secondary">Inspect saved Native outcomes</button><button data-action="batch-save" class="secondary">Save private batch plan</button></div></div></section>`;
    }
    if(status){
      html+=`<section class="panel"><div class="panel-title"><h2>Exact batch readback</h2></div><div class="panel-body"><p>State: <strong>${esc(status.state)}</strong> · ${esc(status.completed_documents)} complete / ${esc(status.total_documents)} selected. No document published.</p>`+
        `<div class="carry-batch-plan">`+status.rows.map(row=>
          `<p><strong>${esc(row.destination_name)}</strong> · ${esc(row.state)} ${row.deliverable_id?'<code>'+esc(row.deliverable_id)+'</code>':'No draft yet'}</p>`).join('')+'</div>'+
        (status.requires_manual_reconciliation?
          '<p>Partial operation: inspect source and edits before deliberately applying the SAME saved plan; never regenerate a replacement silently.</p>':'')+
        `<p class="small-note">Each ready item needs independent current-build editorial and technical review. Artifacts and old approval were not inherited.</p></div></section>`;
    }
    return html+`<div class="callout"><strong>Incremental progress is not publication</strong>The batch writes each exact R70 Native document and declared provenance relation under one shared owner lock. A partial crash is never reported as all-ready. No customer source is executed or deployed.</div>`;
  }
  async function prepare(destinationReleaseId,{rights=false,review=false}={}){
    if(!candidateId||!destinationReleaseId||chosen.size<2||chosen.size>8)
      throw Error('Select two to eight frozen Markdown documents and a destination release');
    if(!rights||!review)
      throw Error('Historical source rights and new build re-review acknowledgements are required');
    const items=[...chosen.entries()].map(([source_artifact_id,data])=>{
      if(!data.destination_name?.trim()||!data.destination_target_id)
        throw Error('Every selected document needs a title and exactly matched destination Target');
      return{source_artifact_id,
        destination_target_id:data.destination_target_id,
        destination_name:data.destination_name};
    });
    const result=await api.planCarryForwardBatch({
      source_candidate_id:candidateId,destination_release_id:destinationReleaseId,
      items,acknowledge_historical_rights:true,
      acknowledge_editorial_recheck:true
    });
    if(!hash(result.plan_sha256))throw Error('No exact batch hash from Native-backed service');
    plan=result;status=null;return plan;
  }
  async function restore(saved){
    if(!saved||saved.schema_version!=='launchwright-carry-forward-batch-plan/1'||
      !hash(saved.plan_sha256)||!hash(saved.source_candidate_sha256))
      throw Error('Restore the complete original R71 plan JSON');
    const verified=await api.inspectCarryForwardBatch(saved);
    candidateId=saved.source_candidate_id;
    chosen.clear();
    for(const p of saved.plans)chosen.set(p.source_artifact_id,{
      destination_target_id:p.destination_target_id,
      destination_name:p.destination_name
    });
    plan=saved;status=verified;return verified;
  }
  async function inspect(){
    if(!plan)throw Error('Prepare or restore original R71 batch plan');
    status=await api.inspectCarryForwardBatch(plan);
    return status;
  }
  async function apply(confirmations){
    if(!plan)throw Error('Prepare the exact batch plan');
    if(confirmations?.acknowledge_create_all_drafts!==true)
      throw Error('All selected Native document writes require explicit consent');
    const result=await api.applyCarryForwardBatch(plan,confirmations);
    status=await api.inspectCarryForwardBatch(plan);
    if(status.state!=='BATCH_READY'||status.completed_documents!==plan.document_count)
      throw Error('Native batch status is not fully reconciled after write');
    return result;
  }
  function downloadPlan(){
    if(!plan)throw Error('Prepare or restore original R71 plan');
    return JSON.stringify(plan,null,2)+'\n';
  }
  return{chooseCandidate,toggle,update,render,prepare,restore,inspect,apply,
    clear,downloadPlan,
    get candidateId(){return candidateId;},
    get selected(){return [...chosen.entries()];},
    get plan(){return plan;},get status(){return status;}};
}
