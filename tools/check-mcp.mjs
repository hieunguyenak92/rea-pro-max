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
const names = ['get_capabilities','inspect_artifact','read_artifact','create_case','revise_case','record_observation','rank_probes','verify_behavior','reconcile_runtime','export_artifact','run_owned_lab','list_task_prompts','import_case','read_source_evidence','capture_feature','replay_feature','capture_web','replay_web','run_recovery','craft_provider_doctor','craft_provider_inspect','craft_provider_capture','craft_provider_compare','compare_artifacts','compare_api_contract','inspect_wasm_interface','compare_wasm_interfaces','inspect_playwright_trace','check_release','inspect_deployment_targets','compare_deployment_targets', 'compare_jar_profiles', 'compare_wasm_behavior', 'import_ghidra_evidence', 'verify_native_behavior'];
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
      const sameBuild = await call('compare_artifacts',{reference_path:'target',candidate_path:'target'});
      assert.equal(sameBuild.summary.status,'same-admitted-bytes');
      cpSync(resolve(dirname(entry),'../assets/labs/api'),join(workspace,'api'),{recursive:true});
      const coverage = await call('compare_api_contract',{openapi_path:'api/openapi.json',har_path:'api/traffic.har'});
      assert.equal(coverage.summary.operations,3);
      const observations = await call('read_artifact',{handle:coverage.handle,section:'observations',limit:1});
      assert.equal(observations.total,3);assert.equal(observations.next_offset,1);
      const releaseFixture = join(workspace,'release');
      cpSync(resolve(dirname(entry),'../assets/labs/release'),releaseFixture,{recursive:true});
      const release = await call('check_release',{path:'release/policy.json'});
      assert.equal(release.summary.status,'pass');assert.equal(release.summary.checks.length,4);
      const abi = await call('compare_wasm_interfaces',{reference_path:'release/reference/engine.wasm',candidate_path:'release/candidate/engine.wasm'});
      assert.equal(abi.summary.status,'same-interface');
      const inspectedAbi = await call('inspect_wasm_interface',{path:'release/candidate/engine.wasm'});
      assert.equal(inspectedAbi.summary.exports,1);
      const wasm = await call('compare_wasm_behavior', {
        reference_path: 'release/reference/engine.wasm', candidate_path: 'release/candidate/engine.wasm',
        contract_path: 'release/wasm-behavior.json',
      });
      assert.equal(wasm.summary.status, 'fail');
      const wasmCases = await call('read_artifact', { handle: wasm.handle, section: 'cases' });
      assert.deepEqual([wasmCases.items[0].reference.value, wasmCases.items[0].candidate.value], [1, 2]);
      cpSync(resolve(dirname(entry), '../assets/labs/jar-profiles'), join(workspace, 'jar-profiles'), { recursive: true });
      const jar = await call('compare_jar_profiles', {
        reference_path: 'jar-profiles/before.jar', candidate_path: 'jar-profiles/after.jar', profiles: [11, 17],
      });
      assert.equal(jar.summary.status, 'different');
      const profiles = await call('read_artifact', { handle: jar.handle, section: 'profiles' });
      assert.deepEqual(profiles.items.map(item => item.status), ['same-selection', 'different']);
      const trace = await call('inspect_playwright_trace',{trace_path:'release/catalog.trace'});
      assert.equal(trace.summary.status,'complete');assert.equal(trace.summary.coverage.actions.completed,4);
      await call('export_artifact',{handle:release.handle,output_path:'release-verdict.json',format:'json'});
      assert.equal(JSON.parse(readFileSync(join(workspace,'release-verdict.json'),'utf8')).receipt_sha256,release.summary.receipt_sha256);
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
      cpSync(resolve(dirname(entry),'../assets/labs/targets'),join(workspace,'targets'),{recursive:true});
      const target = await call('inspect_deployment_targets',{path:'targets/java11/TargetSample.class'});
      assert.equal(target.summary.format,'jvm-class');
      const targetDiff = await call('compare_deployment_targets',{reference_path:'targets/universal-macos11.o',candidate_path:'targets/arm64-macos12.o'});
      assert.equal(targetDiff.summary.status,'narrowed');
      const losses = await call('read_artifact',{handle:targetDiff.handle,section:'changes',limit:2});
      assert.deepEqual(losses.items.map(row => row.reason).sort(),['minimum_os_raised','target_removed']);
      const nativeRelease = await call('check_release',{path:'targets/policy.json'});
      assert.deepEqual(nativeRelease.summary.checks.map(row => row.status),['pass','fail']);
      const savedNative = resolve(dirname(entry), '../assets/labs/native-recovery/evidence');
      cpSync(savedNative, join(workspace, 'native'), { recursive: true });
      const ghidra = await call('import_ghidra_evidence', {
        binary_path: 'native/reference.bin', export_path: 'native/ghidra-12.2-arm64.json',
      });
      assert.equal(ghidra.summary.status, 'complete');
      const native = await call('verify_native_behavior', {
        reference_path: 'native/reference.json', candidate_path: 'native/negative.json', oracle_path: 'native/oracle.json',
      });
      assert.equal(native.summary.status, 'fail');
      const discrepancies = await call('read_artifact', { handle: native.handle, section: 'differences' });
      assert.equal(discrepancies.items[0].input, 173);
      results.push({protocol:modern?'2026-07-28 discovery':'legacy initialization',tools:names.length,inspection:true,artifact_comparison:true,deployment_targets:true,jar_profiles:true,api_contract_comparison:true,wasm_interface:true,wasm_behavior:true,ghidra_evidence:true,native_verification:true,playwright_trace:true,release_policy:true,portable_case:true,source_excerpt:true,actual_browser_replay:Boolean(values.browser),owned_lab:'intentional mismatch; 3 retained actions',finite_verification:'fail preserved as a valid result',report_bytes:exported.bytes});
    } finally { await client.close(); assert.equal(stderr,'','MCP server wrote unexpected diagnostics'); }
  }
  console.log(JSON.stringify({server:values.server?'extracted-runtime':'checkout-runtime',version:expectedVersion,checks:results},null,2));
} finally { rmSync(temporary,{recursive:true,force:true}); }
