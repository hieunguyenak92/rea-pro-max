import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: { server: { type: 'string' }, workspace: { type: 'string' }, browser: { type: 'string' } } });
const entry = resolve(values.server || join(root, 'skills/rea-pro-max/scripts/mcp-server.mjs'));
const temporary = mkdtempSync(join(values.workspace || tmpdir(), 'rpm-mcp-smoke-'));
const expectedVersion = JSON.parse(readFileSync(join(root,'package.json'),'utf8')).version;
const names = ['get_capabilities','inspect_artifact','read_artifact','create_case','revise_case','record_observation','rank_probes','verify_behavior','export_artifact','run_owned_lab','list_task_prompts','import_case','read_source_evidence','capture_feature','replay_feature','capture_web','replay_web','craft_provider_doctor','craft_provider_inspect','craft_provider_capture','craft_provider_compare'];
const results = [];
try {
  for (const modern of [false,true]) {
    const workspace = join(temporary, modern ? 'modern' : 'legacy'); mkdirSync(workspace);
    cpSync(resolve(dirname(entry),'../assets/labs/mv3/reference'),join(workspace,'target'),{recursive:true});
    const client = new Client({ name:'rea-pro-max-package-check',version:'1.0.0' }, modern ? {versionNegotiation:{mode:'auto'}} : {});
    const transport = new StdioClientTransport({command:process.execPath,args:[entry,'--workspace',workspace,...(values.browser?['--browser',values.browser]:[])],cwd:workspace,stderr:'pipe'});
    let stderr=''; transport.stderr?.on('data',bytes=>{stderr+=bytes.toString();});
    const call = async(name,args={})=>{
      const value = await client.callTool({name,arguments:args});
      assert.notEqual(value.isError,true,JSON.stringify(value));
      assert.ok(value.structuredContent,`${name} lacks a structured result`);return value.structuredContent;
    };
    try {
      await client.connect(transport);
      assert.equal(Boolean(client.getDiscoverResult()),modern);
      assert.equal(client.getServerVersion().version,expectedVersion);
      assert.deepEqual((await client.listTools()).tools.map(tool=>tool.name).sort(),names.toSorted());
      const capabilities = await call('get_capabilities'); assert.equal(capabilities.execution_policy.arbitrary_oracle,false);
      const inspected = await call('inspect_artifact',{path:'target'});
      assert.equal(inspected.summary.artifact.kind,'manifest-v3');
      const evidence = await call('read_artifact',{handle:inspected.handle,section:'evidence',limit:1});assert.equal(evidence.items.length,1);
      const source = await call('read_source_evidence',{inspection_handle:inspected.handle,evidence_id:evidence.items[0].id,max_chars:100}); assert.equal(typeof source.source,'string'); assert.ok(source.source.length<=100);
      if (!values.browser) {
        const disabled = await client.callTool({name:'capture_feature',arguments:{extension_path:'target',scenario_path:'none.json'}});assert.equal(disabled.structuredContent.error.code,'runtime_disabled');
      } else {
        assert.equal(capabilities.execution_policy.target_execution,true);
        const recoveryAssets=resolve(dirname(entry),'../assets/recovery');
        for (const variant of ['reference','starter','recovered']) cpSync(join(recoveryAssets,variant),join(workspace,variant),{recursive:true});
        cpSync(join(recoveryAssets,'scenario.json'),join(workspace,'scenario.json'));
        const capture=await call('capture_feature',{extension_path:'reference',scenario_path:'scenario.json'});assert.equal(capture.summary.complete,true);
        const before=await call('replay_feature',{reference_path:'reference',candidate_path:'starter',scenario_path:'scenario.json'});assert.equal(before.summary.status,'fail');assert.equal(before.summary.first_mismatch,'cold-read');
        const after=await call('replay_feature',{reference_path:'reference',candidate_path:'recovered',scenario_path:'scenario.json'});assert.equal(after.summary.status,'pass');
        await call('export_artifact',{handle:after.handle,output_path:'replay.json',format:'json'});
        assert.equal(JSON.parse(readFileSync(join(workspace,'replay.json'),'utf8')).verification.status,'pass');
      }
      const record = await call('create_case',{inspection_handle:inspected.handle,goal:'Package smoke case'});
      await call('export_artifact',{handle:record.handle,output_path:'case.json',format:'json'});
      const imported = await call('import_case',{path:'case.json'});assert.equal(imported.summary.revision,1);
      const lab = await call('run_owned_lab');assert.equal(lab.summary.verification,'fail');assert.equal(lab.summary.reduction.retained_actions,3);
      const sequence = await call('read_artifact',{handle:lab.handle,section:'/reduction/sequence'});assert.deepEqual(sequence.items.map(action=>action.type),['save','restart','read']);
      const exported = await call('export_artifact',{handle:lab.handle,output_path:'report.html',format:'html'});
      assert.ok(exported.bytes>1000);assert.match(readFileSync(join(workspace,exported.path),'utf8'),/rpm-data/u);
      const bindings=Object.fromEntries(['target','scenario','reset','toolchain','verifier'].map((name,index)=>[name+'_sha256',String(index+1).repeat(64)]));
      const reference={schema_version:1,bindings,complete:true,cases:[{id:'one',input:{text:'Café'},output:true,state:[],effects:[]}]};
      writeFileSync(join(workspace,'reference.json'),JSON.stringify(reference));
      writeFileSync(join(workspace,'candidate.json'),JSON.stringify({...reference,cases:[{...reference.cases[0],output:false}]}));
      const verdict=await call('verify_behavior',{reference_path:'reference.json',candidate_path:'candidate.json'});assert.equal(verdict.summary.status,'fail');
      const prompts=await call('list_task_prompts',{limit:1});assert.equal(prompts.catalog_total,36);
      results.push({protocol:modern?'2026-07-28 discovery':'legacy initialization',tools:names.length,inspection:true,portable_case:true,source_excerpt:true,actual_browser_replay:Boolean(values.browser),owned_lab:'intentional mismatch; 3 retained actions',finite_verification:'fail preserved as a valid result',report_bytes:exported.bytes});
    } finally { await client.close(); assert.equal(stderr,'','MCP server wrote unexpected diagnostics'); }
  }
  console.log(JSON.stringify({server:values.server?'extracted-runtime':'checkout-runtime',version:expectedVersion,checks:results},null,2));
} finally { rmSync(temporary,{recursive:true,force:true}); }
