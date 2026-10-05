#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
import { readdirSync, lstatSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
const [directory,output]=process.argv.slice(2);if(!directory||!output)throw Error('Usage: node scripts/pin-platform-sdk.mjs /owner/sdk/client-typescript /outside-repo/platform-lock.json');
const root=realpathSync(directory),pkg=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
if(pkg.name!=='@semwright/platform-client'||pkg.version!=='0.3.5-dev.1')throw Error('Adapter was reviewed only against @semwright/platform-client 0.3.5-dev.1');
const files={};function walk(path){for(const name of readdirSync(path)){if(name==='node_modules'||name.startsWith('.'))continue;const file=join(path,name),s=lstatSync(file);if(s.isSymbolicLink())throw Error('Symlinks cannot be source-pinned');if(s.isDirectory())walk(file);else if(s.isFile())files[relative(root,file).replaceAll('\\','/')]=createHash('sha256').update(readFileSync(file)).digest('hex');}}
walk(root);writeFileSync(resolve(output),JSON.stringify({schema_version:'launchwright-platform-sdk-lock/1',package_version:pkg.version,files},null,2)+'\n',{flag:'wx',mode:0o600});console.log('Pinned source bytes only. This is not live service or budget acceptance.');
