#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// R38: standard MCP stdio transport over the PUBLIC Launchwright Client SDK.
// Deliberately no application/SQLite, Platform or Semwright private imports.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LaunchwrightClient } from '../client/index.mjs';
import {
  createLaunchwrightMcpTools, createMcpPendingJournal,
  readLocalMcpToken,localLoopbackUrl
} from '../src/mcp-public-tools.mjs';

function options(argv){
  const opts={};
  for(let i=0;i<argv.length;i++){
    const key=argv[i];
    if(!['--url','--token-file','--pending-dir'].includes(key)||
      Object.hasOwn(opts,key)||!argv[i+1]||argv[i+1].startsWith('--'))
      throw Error('Expected explicit --url, --token-file, --pending-dir');
    opts[key]=argv[++i];
  }
  if(Object.keys(opts).length!==3)throw Error('MCP local owner configuration is incomplete');
  if(!isAbsolute(opts['--token-file'])||!isAbsolute(opts['--pending-dir']))
    throw Error('MCP credential and custody paths must be absolute');
  return opts;
}
export async function serveLocalMcp(config){
  const url=localLoopbackUrl(config['--url']);
  const token=readLocalMcpToken(config['--token-file']);
  const journal=createMcpPendingJournal(config['--pending-dir']);
  const client=new LaunchwrightClient({baseUrl:url,token,pendingStore:journal});
  // Preflight the authenticated app once. No mutation or remote connection.
  const description=await client.describe();
  if(description?.native_sdk!=='1.0.0')
    throw Error('The configured local application does not expose the pinned Native SDK v1 contract');
  const tools=createLaunchwrightMcpTools(client,journal);
  const server=new Server({name:'launchwright-local-public-client',version:'1.0.0'},{
    capabilities:{tools:{}},
    instructions:'Use returned IDs and exact request revisions. Mutation tools require explicit prepare, human confirmation and submit; ambiguous outcomes must use recover instead of retry. The app is local, imported evidence may remain UNKNOWN, and no Platform/public Publish authority is granted.'
  });
  server.setRequestHandler(ListToolsRequestSchema,async()=>tools.list());
  server.setRequestHandler(CallToolRequestSchema,async(req)=>
    tools.call(req.params.name,req.params.arguments??{}));
  await server.connect(new StdioServerTransport());
  return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{await serveLocalMcp(options(process.argv.slice(2)));}
  catch(err){
    // Never print token, full environment, pending bytes or auth response to
    // stderr: MCP clients can include stderr in untrusted logs.
    process.stderr.write('Launchwright local MCP configuration or connection is invalid. Check documented owner URL, private token and pending directory.\n');
    process.exitCode=1;
  }
}
