// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rust=readFileSync(new URL('../acceptance/chromium_deltadesk_broker.rs',import.meta.url),'utf8');
const workflow=readFileSync(new URL('../.github/workflows/heavy.yml',import.meta.url),'utf8');
const verifier=readFileSync(new URL('../scripts/verify-deltadesk-browser.mjs',import.meta.url),'utf8');

test('R23 routes the owned DeltaDesk oracle through real Broker and Policy code',()=>{
  for(const required of [
    'Broker::new(',
    'Policy::new(',
    'Chromium::new(',
    '"browser.launch"',
    '"browser.semantic.query"',
    '"browser.element.select"',
    '"browser.element.click"',
    '"browser.screenshot"',
    '"broker_policy_path_observed": true'
  ]) assert.ok(rust.includes(required),`missing R23 broker acceptance marker: ${required}`);

  assert.ok(rust.includes('Arc::new(NoApprover)'),'negative policy fixture must not auto-approve');
  assert.ok(rust.includes('"missing_browser_modify_denied": true'));
  assert.ok(rust.includes('"forbidden_origin_denied": true'));
  assert.ok(rust.includes('"human_operator_approval": false'));
  assert.ok(rust.includes('"driver_host_isolation": false'));
  assert.ok(rust.includes('"platform_execution_authority": false'));
});

test('R23 fixture approver is bounded to sensitive browser acceptance only',()=>{
  assert.match(rust,/approval\.backend == "chromium"/);
  assert.match(rust,/"browser\.launch" \| "browser\.screenshot"/);
  assert.ok(!rust.includes('approval.command.starts_with("browser.")'));
  assert.ok(!rust.includes('Ok(true)\n    }\n}'),'approver must not unconditionally approve every command');
  assert.ok(rust.includes('fixture approval surface changed unexpectedly'));
});

test('R23 heavy lane builds against exact pinned Semwright without changing product source',()=>{
  assert.ok(workflow.includes('cp acceptance/chromium_deltadesk_broker.rs .ci-semwright/crates/daemon/tests/launchwright_deltadesk_broker.rs'));
  assert.ok(workflow.includes('cargo test --locked -p semwright-daemon --test launchwright_deltadesk_broker'));
  assert.ok(!workflow.includes('semwright-adapters.workspace = true'),'R23 must not mutate the pinned Semwright manifest/lock');
  assert.ok(workflow.includes('REAL_DELTADESK_BROKER_ACCEPTANCE_PASS'));
  assert.ok(workflow.includes('semwright-deltadesk-broker.json'));
  assert.ok(!workflow.includes('cargo test --release -p semwright-daemon --test launchwright_deltadesk_broker'));
});

test('R23 ingestion preserves Broker evidence without manufacturing canonical capture PASS',()=>{
  assert.ok(verifier.includes("receipt.schema_version==='launchwright-deltadesk-browser-broker/1'"));
  assert.ok(verifier.includes("receipt.broker_policy_path_observed,true"));
  assert.ok(verifier.includes("receipt.human_operator_approval,false"));
  assert.ok(verifier.includes("receipt.platform_execution_authority,false"));
  assert.ok(verifier.includes("state:brokered?'PASS':'UNKNOWN'"));
  assert.ok(verifier.includes("canonical_capture_admitted:false"));
  assert.ok(verifier.includes("driver_host_isolation_accepted:false"));
  assert.ok(verifier.includes("technical_pass_claimed:false"));
  assert.ok(verifier.includes("assert.equal(stored.data.technical,'UNKNOWN')"));
  assert.ok(verifier.includes("assert.equal(stored.data.observed_state_eligible,false)"));
});
