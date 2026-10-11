// SPDX-License-Identifier: AGPL-3.0-only
// R69: GitHub DRAFT requests only on explicit owner clicks, never background
// retry after an unknown external POST. The operator must manually push R40.
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));
const sha64=x=>typeof x==='string'&&/^[a-f0-9]{64}$/u.test(x);
const sha40=x=>typeof x==='string'&&/^[a-f0-9]{40}$/u.test(x);
export function createGitDocsDraftController(api){
  let plan=null,root='',branchPlan=null,receipt=null;
  function clear(){plan=null;root='';branchPlan=null;receipt=null;}
  async function prepare(r40,repoRoot,{title,editorial_note,acknowledge_draft_only}={}){
    if(!r40||!repoRoot||!sha64(r40.plan_sha256))
      throw Error('Create or restore the exact R40 local branch first');
    if(acknowledge_draft_only!==true)
      throw Error('Explicitly acknowledge this is only a GitHub Draft PR');
    const prepared=await api.planLocalGitDocsDraft({
      repository_root:repoRoot,branch_plan:r40,title,editorial_note,
      acknowledge_draft_only:true
    });
    if(!sha64(prepared.intent?.intent_sha256))
      throw Error('Server returned no exact R41 Draft PR intent hash');
    plan=prepared.intent;branchPlan=r40;root=repoRoot;receipt=null;
    return plan;
  }
  async function restore(saved,r40,repoRoot){
    if(!saved||saved.schema_version!=='launchwright-git-docs-draft-pr-intent/1'||
      !sha64(saved.intent_sha256)||!sha40(saved.local_branch_commit_sha)||
      !r40||saved.branch_plan_sha256!==r40.plan_sha256||!repoRoot)
      throw Error('Saved Draft PR intent does not match the original R40 branch');
    const verified=await api.planLocalGitDocsDraft({
      repository_root:repoRoot,branch_plan:r40,title:saved.title,
      editorial_note:saved.editorial_note,acknowledge_draft_only:true
    });
    if(JSON.stringify(verified.intent)!==JSON.stringify(saved))
      throw Error('Saved Draft PR intent does not match exact current Native/Git identity');
    plan=saved;branchPlan=r40;root=repoRoot;receipt=null;
    return plan;
  }
  function scope(){
    if(!plan||!branchPlan||!root)
      throw Error('Prepare or restore the exact Draft PR intent first');
    return{repository_root:root,branch_plan:branchPlan,intent:plan,
      confirm_repository:plan.repository,
      confirm_branch_plan_sha256:plan.branch_plan_sha256,
      confirm_local_commit_sha:plan.local_branch_commit_sha};
  }
  async function send(confirmations){
    const s=scope();
    if(!confirmations||confirmations.acknowledge_first_send!==true||
      confirmations.acknowledge_remote_branch_pushed!==true)
      throw Error('Manual Git push and first-send approval are required');
    // Do NOT retry when the HTTP reply is missing: recover() reads only.
    receipt=await api.sendLocalGitDocsDraft({
      ...s,...confirmations
    });
    if(receipt.state!=='REMOTE_DRAFT_CREATED')
      throw Error('No verified GitHub Draft PR receipt returned');
    return receipt;
  }
  async function recover(){
    // Read-only reconciliation of an uncertain remote outcome.
    receipt=await api.recoverLocalGitDocsDraft(scope());
    if(receipt.state!=='REMOTE_DRAFT_CREATED')
      throw Error('Remote result is not an exact verified Draft PR');
    return receipt;
  }
  function downloadIntent(){
    if(!plan)throw Error('Prepare or import an exact R41 intent first');
    return JSON.stringify(plan,null,2)+'\n';
  }
  function render(r40,branchStatus){
    if(plan&&plan.branch_plan_sha256!==r40?.plan_sha256)clear();
    let html=`<section class="panel"><div class="panel-title"><h2>GitHub Draft PR handoff · separate authorization</h2></div><div class="panel-body"><p>R40 writes a local docs-review branch only. Independently review and push that exact branch using your approved Git workflow. This R41 step can request a GitHub <strong>Draft PR</strong>, not merge, publish or deploy.</p><div class="actions"><button data-action="docs-pr-plan" ${r40&&branchStatus?.state==='LOCAL_BRANCH_READY'?'':'disabled'}>Prepare GitHub Draft</button><button data-action="docs-pr-load" ${r40?'':'disabled'} class="secondary">Restore saved Draft intent</button><button data-action="docs-pr-clear" class="secondary">Clear Draft intent</button></div></div></section>`;
    if(plan){
      const rows=[
        ['Draft intent SHA-256',plan.intent_sha256],
        ['R40 plan SHA-256',plan.branch_plan_sha256],
        ['Git repository',plan.repository],
        ['Local reviewed commit',plan.local_branch_commit_sha],
        ['Remote head branch',plan.head_branch],
        ['Exact title',plan.title],
        ['Technical state',plan.technical_state]
      ];
      html+=`<section class="panel"><div class="panel-title"><h2>${receipt?'Draft intent · remote verified':'Prepared Draft intent · NOT SENT'}</h2></div><div class="panel-body"><dl class="fact-list docs-git-facts">`+
        rows.map(([k,v])=>`<div><dt>${esc(k)}</dt><dd><code class="docs-git-hash">${esc(v)}</code></dd></div>`).join('')+
        `</dl><p>Save this intent privately. Independently push the exact R40 branch before sending. Retype the repository, branch plan and local commit; confirm that a remote Draft PR will be created. Unknown outcomes must use recover-only.</p><div class="actions"><button data-action="docs-pr-send">Authorize first Draft PR send</button><button data-action="docs-pr-recover" class="secondary">Recover exact remote Draft (read only)</button><button data-action="docs-pr-save" class="secondary">Download private R41 intent</button></div></div></section>`;
    }
    if(receipt){
      html+=`<section class="panel"><div class="panel-title"><h2>Verified GitHub Draft receipt</h2></div><div class="panel-body"><p>State: <strong>${esc(receipt.state)}</strong>. Merge and publication: <strong>not performed</strong>.</p><p><a href="${esc(receipt.pr_url)}" rel="noopener noreferrer" target="_blank">Open exact GitHub Draft PR #${esc(receipt.pr_number)}</a></p><p class="small-note">Recovered: ${esc(receipt.recovered)} · external push performed by Launchwright: false · technical state not upgraded.</p></div></section>`;
    }
    return html;
  }
  return{prepare,restore,send,recover,downloadIntent,render,clear,
    get plan(){return plan;},get receipt(){return receipt;}};
}
