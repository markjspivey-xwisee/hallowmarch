// Actual source with fake GL/CPU clocks only. No shader compilation, browser or driver-cause claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {parse} from '../node_modules/acorn/dist/acorn.mjs';
import {basicFixture} from './title_rolling_fixture.mjs';
import {undoStructureFamilyPriority} from './title_structure_priority_fixture.mjs';
const root=new URL('../../',import.meta.url),read=path=>readFileSync(new URL(path,root),'utf8'),sha=text=>createHash('sha256').update(text).digest('hex');
const source=read('src/13o_title_compile.js'),tree=parse(source,{ecmaVersion:'latest'}),node=tree.body.find(value=>value.type==='FunctionDeclaration'&&value.id.name==='titleFailedProgramDiagnostics');
assert(node);const helper=source.slice(node.start,node.end),plain=value=>JSON.parse(JSON.stringify(value));
function fixture(options={}){
  const handle={},program={id:7,program:handle,diagnostics:options.cached},calls=[];
  const state={lost:!!options.lost},renderer={info:{programs:options.foreign?[]:[program]}};
  const ctx=vm.createContext({renderer,GRAPHICS_CONTEXT_LOST:!!options.globalLost,TextEncoder:options.noEncoder?undefined:TextEncoder});
  const gl={
    isContextLost(){calls.push('context');return state.lost;},
    isProgram(value){calls.push('isProgram');assert.equal(value,handle);options.onIsProgram?.({state,program,renderer,ctx,calls});return options.invalidProgram?false:true;},
    getProgramInfoLog(value){calls.push('programLog');assert.equal(value,handle);if('throwValue' in options)throw options.throwValue;if(options.throwLog)throw Error('mock diagnostic API failure');options.onLog?.({state,program,renderer,ctx,calls});return options.log===undefined?'actual failed program log':options.log;},
  };
  for(const name of ['getError','isShader','getShaderParameter','getShaderInfoLog','getShaderSource','getAttachedShaders','compileShader','linkProgram','validateProgram','useProgram','drawArrays','getExtension'])gl[name]=()=>{calls.push('FORBIDDEN:'+name);throw Error(name);};
  for(const name of ['vertexShader','fragmentShader','getUniforms','getAttributes','destroy'])Object.defineProperty(program,name,{get(){calls.push('FORBIDDEN:'+name);throw Error(name);}});
  if(options.missingApi)delete gl[options.missingApi];if(options.disposed)program.program=null;
  ctx.gl=gl;vm.runInContext(helper+';globalThis.runDiagnostic=titleFailedProgramDiagnostics;',ctx);
  return {run:()=>ctx.runDiagnostic(program),handle,program,renderer,state,ctx,gl,calls};
}
test('only the exact new helper and failed-branch call differ from the pinned release queue',()=>{
  const oracle=JSON.parse(read('tools/tests/fixtures/title_program_diagnostics_fc983.json'));
  assert.equal(oracle.revision,'fc983ff6d582b3daa0983dca25fa57435f0c8cfd');assert.equal(sha(oracle.source),'7df3b4483d92d5f451438759edb25395fe387540a6335fad53d352c854980083');assert.equal(oracle.sha256,sha(oracle.source));
  const control=undoStructureFamilyPriority(source),start=control.indexOf('// Failure-only observations.'),block=control.slice(start,node.end)+'\n\n',call='              Object.assign(receipt.failedProgram, titleFailedProgramDiagnostics(program));\n';
  assert(start>0);assert.equal(control.split(block).length,2);assert.equal(control.split(call).length,2);assert.equal(control.replace(block,'').replace(call,''),oracle.source);
});
test('one live owned failed program log is read once with positive pre/post checks and no shader API',()=>{
  const f=fixture(),result=f.run();assert.equal(result.programLog,'actual failed program log');assert.equal(result.programLogSource,'live-failed-program');assert.equal(f.calls.filter(x=>x==='programLog').length,1);assert.equal(f.calls.filter(x=>x==='isProgram').length,2);assert.equal(result.vertexLog,null);assert.equal(result.fragmentLog,null);assert(!f.calls.some(x=>x.startsWith('FORBIDDEN:')));
});
test('existing cached logs copy flat fields without any GL read or first-use initializer',()=>{
  const f=fixture({cached:{programLog:'cached program',vertexShader:{log:'cached vertex',prefix:'never retained'},fragmentShader:{log:'cached fragment',prefix:'never retained'}}}),result=f.run();
  assert.deepEqual(f.calls,[]);assert.equal(result.programLog,'cached program');assert.equal(result.vertexLog,'cached vertex');assert.equal(result.fragmentLog,'cached fragment');assert.equal(result.vertexLogSource,'cached-r160-diagnostics');assert(!JSON.stringify(result).includes('never retained'));
});
test('empty and malformed log values stay explicit, without object string coercion or a repair query',()=>{
  let coerced=0;const unknown={toString(){coerced++;return 'invented';}};
  const bad=fixture({cached:{programLog:unknown,vertexShader:{log:unknown}}}),r=bad.run();assert.equal(r.programLog,null);assert.equal(r.vertexLog,null);assert.equal(coerced,0);assert.deepEqual(bad.calls,[]);assert.match(r.diagnosticUnavailable.programLog,/not a string/);
  const empty=fixture({cached:{programLog:''}}),e=empty.run();assert.equal(e.programLog,'');assert.match(e.diagnosticUnavailable.programLog,/empty/);assert.deepEqual(empty.calls,[]);
  for(const value of [null,42,unknown]){const f=fixture({log:value}),r=f.run();assert.equal(r.programLog,null);assert(r.diagnosticUnavailable.programLog);assert.equal(f.calls.filter(x=>x==='programLog').length,1);}assert.equal(coerced,0);
});
test('foreign disposed lost invalid or old-mock missing APIs refuse a program-log read',()=>{
  for(const options of [{foreign:true},{disposed:true},{lost:true},{globalLost:true},{invalidProgram:true},{missingApi:'isProgram'},{missingApi:'getProgramInfoLog'},{missingApi:'isContextLost'}]){const f=fixture(options),r=f.run();assert.equal(r.programLog,null);assert(r.diagnosticUnavailable.programLog);assert(!f.calls.includes('programLog'));assert(!f.calls.some(x=>x.startsWith('FORBIDDEN:')));}
});
test('owner or context changes during eligibility stop the expensive log read',()=>{
  for(const onIsProgram of [({program})=>{program.program={replacement:true};},({renderer})=>{renderer.info.programs=[];},({state})=>{state.lost=true;},({ctx})=>{ctx.GRAPHICS_CONTEXT_LOST=true;}]){const f=fixture({onIsProgram}),r=f.run();assert.equal(r.programLog,null);assert(!f.calls.includes('programLog'));assert(r.diagnosticUnavailable.programLog);}
});
test('owner context or validity changes after the one read cannot label returned text as current',()=>{
  for(const onLog of [({program})=>{program.program={replacement:true};},({renderer})=>{renderer.info.programs=[];},({state})=>{state.lost=true;},({ctx})=>{ctx.GRAPHICS_CONTEXT_LOST=true;}]){const f=fixture({onLog}),r=f.run();assert.equal(r.programLog,null);assert(r.diagnosticUnavailable.programLog);assert.equal(f.calls.filter(x=>x==='programLog').length,1);}
  const f=fixture();let count=0;f.gl.isProgram=()=>++count===1;assert.equal(f.run().programLog,null);assert.equal(count,2);
});
test('API exceptions retain unavailable/error facts rather than escaping or trying a fallback',()=>{
  const f=fixture({throwLog:true}),r=f.run();assert.equal(r.programLog,null);assert.match(r.diagnosticError,/mock diagnostic API failure/);assert.match(r.diagnosticUnavailable.programLog,/no fallback/);assert.equal(f.calls.filter(x=>x==='programLog').length,1);assert(!f.calls.some(x=>x.startsWith('FORBIDDEN:')));
  const unreadable=Object.defineProperty({},'message',{get(){throw Error('unreadable message');}}),other=fixture({throwValue:unreadable}),value=other.run();assert.equal(value.programLog,null);assert.equal(value.diagnosticError,'Program diagnostic read threw.');assert.equal(other.calls.filter(x=>x==='programLog').length,1);
});
test('600-character and complete 4096-byte JSON bounds include Unicode escaping and metadata',()=>{
  for(const text of ['界'.repeat(601),'\u0000'.repeat(601),'😀'.repeat(601)]){
    const f=fixture({cached:{programLog:text,vertexShader:{log:text},fragmentShader:{log:text}}}),r=f.run();
    assert(Buffer.byteLength(JSON.stringify(r))<=4096);for(const key of ['programLog','vertexLog','fragmentLog']){assert(r[key].length<=600);assert.equal(r.diagnosticTruncated[key],true);}assert.deepEqual(f.calls,[]);
  }
  const r=fixture({cached:{programLog:'p',vertexShader:{log:'v'},fragmentShader:{log:'f'}}}).run();assert.deepEqual(plain(r.diagnosticTruncated),{programLog:false,vertexLog:false,fragmentLog:false});
});
test('missing byte accounting remains an explicit bounded unavailable selection',()=>{
  const f=fixture({noEncoder:true}),r=f.run();assert.equal(r.programLog,null);assert.equal(r.vertexLog,null);assert.match(r.diagnosticError,/byte accounting unavailable/);assert(Buffer.byteLength(JSON.stringify(r))<=4096);assert.equal(r.diagnosticTruncated.programLog,true);
});
test('actual failed queue branch and catch preserve the original throw and flat titleFailure log flow',async()=>{
  const f=basicFixture({count:1,readyDelay:0,failure:'link'});f.ctx.TextEncoder=TextEncoder;let reads=0;
  f.ctx.gl.isProgram=handle=>f.programs.some(program=>program.program===handle);f.ctx.gl.getProgramInfoLog=()=>{reads++;return 'observed mock linker reason';};
  await assert.rejects(f.finish(f.run()),/A required title program failed to link\./);
  const receipt=f.ctx.GRAPHICS_STARTUP.titlePreparations[0];assert.equal(receipt.outcome,'failed');assert.equal(receipt.completed,false);assert.equal(receipt.error,'A required title program failed to link.');assert.equal(receipt.failedProgram.linked,false);assert.equal(receipt.failedProgram.programLog,'observed mock linker reason');assert.equal(f.ctx.GRAPHICS_STARTUP.titleFailure.programLog,receipt.failedProgram.programLog);assert.equal(reads,1);f.clean();
});
test('older failure mocks with no diagnostic APIs keep the same fatal queue result',async()=>{
  const f=basicFixture({count:1,readyDelay:0,failure:'link'});f.ctx.TextEncoder=TextEncoder;
  await assert.rejects(f.finish(f.run()),/A required title program failed to link\./);const receipt=f.ctx.GRAPHICS_STARTUP.titlePreparations[0];assert.equal(receipt.failedProgram.linked,false);assert.equal(receipt.failedProgram.programLog,null);assert.match(receipt.failedProgram.diagnosticUnavailable.programLog,/API unavailable/);f.clean();
});
test('normal actual queue success performs zero diagnostic work and preserves completion',async()=>{
  const f=basicFixture({count:3,readyDelay:0});let calls=0;f.ctx.titleFailedProgramDiagnostics=()=>{calls++;throw Error('Normal path must never collect diagnostics');};
  const receipt=await f.finish(f.run());assert.equal(receipt.completed,true);assert.equal(calls,0);assert.equal(receipt.failedProgram,undefined);f.clean();
});
