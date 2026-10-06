#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
const args=process.argv.slice(2);
const build=process.env.DELTACLI_BUILD||'build-A';
if(args[0]==='--version'){console.log('deltacli 1.0.0 '+build);process.exit(0);}
if(args[0]==='status'&&args.includes('--json')){
  console.log(JSON.stringify({product:'DeltaCLI',build,mode:'demo',features:{safe_export:true},items:3}));
  process.exit(0);
}
console.error('usage: deltacli status --json | --version');
process.exit(2);
