import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../../src/13_main.js',import.meta.url),'utf8');
const workSource=source.slice(source.indexOf('const BOOT_WORK_BUDGET_MS'),source.indexOf('async function boot()'));
const failureSource=source.slice(source.indexOf('function bootStartFailure('),source.indexOf('boot().catch(bootStartFailure)'));
function harness() {
  let now=0,lost=false,paints=0,reloads=0;
  const events=[],nodes={},errors=[];
  function element(tag) {return {tag,hidden:true,style:{},children:[],attributes:{},
    setAttribute(k,v){this.attributes[k]=v;},appendChild(x){this.children.push(x);},
    replaceChildren(...xs){this.children=xs;},focus(){nodes.focus=this;}};}
  for(const id of ['loading','loadbar','loadmsg','nogl'])nodes[id]=element('div');
  const ctx={performance:{now:()=>now},BOOT_STEPS:[],GRAPHICS_CONTEXT_LOST:false,
    GRAPHICS_STARTUP:{},GAME:{ready:true,started:false,player:{name:'Kept character',xp:37}},
    window:{__hm:{ready:true,UI:{modal:'kit'}}},document:{getElementById:id=>nodes[id],createElement:element},
    location:{reload(){reloads++;}},$:id=>nodes[id],
    graphicsAssertActive(){if(lost)throw Error('Graphics stopped');},
    graphicsCheckpoint(label){events.push('phase:'+label);},
    async nextPaint(){paints++;events.push('paint');if(ctx.onPaint)ctx.onPaint();},
    reportError(e){errors.push(e);},
    graphicsFailureTakeover(notice){notice.hidden=false;ctx.window.__hm.UI.modal=null;events.push('takeover');},
  };
  vm.createContext(ctx);vm.runInContext(workSource+'\n'+failureSource,ctx);
  return {ctx,nodes,events,errors,advance(ms){now+=ms;},lose(){lost=true;},
    get paints(){return paints;},get reloads(){return reloads;},
    receipt(){return {completed:false,chunked:false,chunks:0,yields:0,workMs:0,maxChunkMs:0,maxSliceMs:0,elapsedMs:0};}};
}
test('fine work tokens coalesce within the time budget while preserving execution order',async()=>{
  const h=harness(),seen=[],paintPositions=[],receipt=h.receipt();
  h.ctx.onPaint=()=>paintPositions.push(seen.length);
  function* chunks(){for(let i=0;i<300;i++){h.advance(3);seen.push(i);yield i;}}
  await h.ctx.runBootWork(chunks,receipt);
  assert.deepEqual(seen,Array.from({length:300},(_,i)=>i));
  assert(receipt.completed&&receipt.chunked);
  assert.equal(receipt.workMs,900);assert.equal(receipt.maxChunkMs,3);
  assert(receipt.maxSliceMs<=10);assert(h.paints>=90&&h.paints<=110,'one paint per budget, not one per token');
  assert(paintPositions.every((n,i)=>n-(paintPositions[i-1]||0)<=3));
});
test('one indivisible task is measured honestly rather than claimed to fit the budget',async()=>{
  const h=harness(),receipt=h.receipt();
  await h.ctx.runBootWork(()=>h.advance(47),receipt);
  assert.equal(receipt.workMs,47);assert.equal(receipt.maxChunkMs,47);assert.equal(receipt.maxSliceMs,47);
  assert(receipt.completed&&!receipt.chunked);assert.equal(h.paints,0);
});
test('an asynchronous wait is not counted as synchronous main-thread work',async()=>{
  const h=harness(),receipt=h.receipt();let finish;
  const pending=h.ctx.runBootWork(()=>{h.advance(3);return new Promise(r=>{finish=r;});},receipt);
  h.advance(5000);finish();await pending;
  assert.equal(receipt.workMs,3);assert.equal(receipt.maxChunkMs,3);assert(receipt.completed);
});
test('context loss during a paint stops before another canonical chunk runs',async()=>{
  const h=harness(),receipt=h.receipt(),seen=[];
  h.ctx.onPaint=()=>h.lose();
  function* chunks(){for(let i=0;i<20;i++){seen.push(i);h.advance(5);yield;}}
  await assert.rejects(h.ctx.runBootWork(chunks,receipt),/Graphics stopped/);
  assert.deepEqual(seen,[0,1]);assert.equal(receipt.completed,false);
});
test('a failed chunk stops later tasks and retains the time already spent',async()=>{
  const h=harness(),receipt=h.receipt(),seen=[];
  function* bad(){seen.push('first');h.advance(2);yield;h.advance(4);throw Error('bad terrain');}
  const tasks=[()=>bad(),()=>seen.push('must not run')];
  await assert.rejects(h.ctx.runBootWork(()=>h.ctx.bootSequence(tasks),receipt),/bad terrain/);
  assert.deepEqual(seen,['first']);assert.equal(receipt.workMs,6);assert.equal(receipt.completed,false);
  assert.equal(receipt.maxSliceMs,6);
});
test('an expensive iterator factory yields before starting its next chunk',async()=>{
  const h=harness(),receipt=h.receipt(),seen=[];h.ctx.onPaint=()=>seen.push('paint');
  await h.ctx.runBootWork(()=>{h.advance(12);return (function*(){seen.push('chunk');yield;})();},receipt);
  assert.deepEqual(seen,['paint','chunk']);assert.equal(receipt.maxChunkMs,12);
});
test('the browser scheduler gets real task boundaries with its receiver preserved',async()=>{
  const h=harness(),receipt=h.receipt(),seen=[];let yields=0;
  const scheduler={yield(){assert.equal(this,scheduler);yields++;return new Promise(resolve=>setImmediate(()=>{seen.push('host');resolve();}));}};
  h.ctx.window.scheduler=scheduler;
  function* chunks(){for(let i=0;i<10;i++){h.advance(5);seen.push(i);yield;}}
  await h.ctx.runBootWork(chunks,receipt);
  assert(yields>0);assert.equal(h.paints,0);assert.equal(yields,receipt.yields);
  assert(seen.indexOf('host')<seen.indexOf(2));
  assert.deepEqual(seen.filter(x=>typeof x==='number'),Array.from({length:10},(_,i)=>i));
});
test('nested generation keeps every synchronous subtask in its original order',async()=>{
  const h=harness(),receipt=h.receipt(),seen=[];
  function* middle(){seen.push(2);yield;seen.push(3);yield;}
  await h.ctx.runBootWork(()=>h.ctx.bootSequence([()=>seen.push(1),()=>middle(),()=>seen.push(4)]),receipt);
  assert.deepEqual(seen,[1,2,3,4]);assert(receipt.completed);
});
test('a sequence waits for an asynchronous subtask before starting its successor',async()=>{
  const h=harness(),receipt=h.receipt(),seen=[];let finish;
  const pending=h.ctx.runBootWork(()=>h.ctx.bootSequence([
    ()=>{seen.push('start');h.advance(2);return new Promise(r=>{finish=r;});},
    ()=>seen.push('after'),
  ]),receipt);
  await Promise.resolve();assert.deepEqual(seen,['start']);
  h.advance(5000);finish();await pending;
  assert.deepEqual(seen,['start','after']);assert.equal(receipt.workMs,2);
  assert(receipt.maxSliceMs<10,'waiting for a promise is not a blocked slice');
});
test('a delegated generator exposes its final work boundary before the next task',async()=>{
  const h=harness(),receipt=h.receipt(),seen=[];
  function* middle(){yield;h.advance(12);seen.push('generator end');}
  h.ctx.onPaint=()=>seen.push('paint');
  await h.ctx.runBootWork(()=>h.ctx.bootSequence([()=>middle(),()=>seen.push('next task')]),receipt);
  assert.deepEqual(seen,['generator end','paint','next task']);
});
test('load steps retain real progress, bounded work receipts and the established boot timeline',async()=>{
  const h=harness();
  for(let i=0;i<20;i++)await h.ctx.loadStep(i/20,'stage '+i,()=>h.advance(2));
  assert.equal(h.ctx.GRAPHICS_STARTUP.bootWork.length,16);assert.equal(h.ctx.BOOT_STEPS.length,20);
  assert.equal(h.nodes.loadbar.style.width,'95%');assert.equal(h.nodes.loadmsg.textContent,'stage 19');
  assert(h.ctx.GRAPHICS_STARTUP.bootWork.every(r=>r.completed&&r.workMs===2));
  assert.equal(h.events.filter(x=>x==='paint').length,20);
});

test('the actual meadow boot step prepares RGB cooperatively after farming before completing',async()=>{
  const h=harness(),seen=[];
  for(const name of ['buildGrass','buildFlowers','buildNature','buildFarming'])h.ctx[name]=()=>seen.push(name);
  h.ctx.prepareMeadowRGBChunks=function*(){
    seen.push('RGB begin');
    for(let row=0;row<16;row++){h.advance(3);seen.push(row);yield;}
    seen.push('RGB complete');
  };
  const start=source.indexOf("  await loadStep(0.58, 'Sowing the meadows'");assert(start>=0);
  const actualStep=source.slice(start,source.indexOf('\n',start)).split('//')[0];
  vm.runInContext('async function prepareActualMeadowStep(){'+actualStep+'}',h.ctx);
  await h.ctx.prepareActualMeadowStep();
  assert.deepEqual(seen.slice(0,5),['buildGrass','buildFlowers','buildNature','buildFarming','RGB begin']);
  assert.deepEqual(seen.slice(5,-1),Array.from({length:16},(_,i)=>i));assert.equal(seen.at(-1),'RGB complete');
  const [receipt]=h.ctx.GRAPHICS_STARTUP.bootWork;
  assert(receipt.completed&&receipt.chunked);assert.equal(receipt.workMs,48);assert(receipt.maxSliceMs<=9);
  assert(receipt.yields>=5);assert.equal(h.ctx.BOOT_STEPS[0][0],'Sowing the meadows');
  assert.equal(h.nodes.loadbar.style.width,'58%');
});
test('the actual ground preparation step stays cooperative before title admission',async()=>{
  const h=harness(),seen=[];
  h.ctx.prepareGroundAOChunks=function*(){for(let i=0;i<12;i++){h.advance(3);seen.push(i);yield;}};
  const start=source.indexOf("  await loadStep(0.83, 'Preparing the ground'");assert(start>=0);
  const actualStep=source.slice(start,source.indexOf('\n',start));
  vm.runInContext('async function prepareActualGroundStep(){'+actualStep+'}',h.ctx);
  await h.ctx.prepareActualGroundStep();
  assert.deepEqual(seen,Array.from({length:12},(_,i)=>i));
  const [receipt]=h.ctx.GRAPHICS_STARTUP.bootWork;
  assert(receipt.completed&&receipt.chunked);assert.equal(receipt.workMs,36);assert(receipt.maxSliceMs<=9);assert(receipt.yields>=3);
});

test('the actual season-map preparation step stays cooperative before title admission',async()=>{
  const h=harness(),seen=[];
  h.ctx.prepareSeasonMapChunks=function*(){for(let i=0;i<12;i++){h.advance(3);seen.push(i);yield;}};
  const start=source.indexOf("  await loadStep(0.835, 'Preparing the seasons'");assert(start>=0);
  const actualStep=source.slice(start,source.indexOf('\n',start));
  vm.runInContext('async function prepareActualSeasonStep(){'+actualStep+'}',h.ctx);
  await h.ctx.prepareActualSeasonStep();
  assert.deepEqual(seen,Array.from({length:12},(_,i)=>i));
  const [receipt]=h.ctx.GRAPHICS_STARTUP.bootWork;
  assert(receipt.completed&&receipt.chunked);assert.equal(receipt.workMs,36);assert(receipt.maxSliceMs<=9);assert(receipt.yields>=3);
});

test('the actual profiling wrapper preserves resumable generation through its last chunk',async()=>{
  const h=harness(),seen=[];
  const perf=readFileSync(new URL('../../src/13p_perf.js',import.meta.url),'utf8');
  const start=perf.indexOf('{\n  const ls0 = loadStep;'),end=perf.indexOf('\n}',start);
  assert(start>=0&&end>start);h.ctx.PERFX={boot:[]};
  vm.runInContext(perf.slice(start,end+2),h.ctx);
  function* chunks(){for(let i=0;i<10;i++){seen.push(i);h.advance(2);yield;}}
  await h.ctx.loadStep(.5,'Measured terrain',chunks);
  assert.deepEqual(seen,Array.from({length:10},(_,i)=>i));
  assert.equal(h.ctx.GRAPHICS_STARTUP.bootWork[0].chunked,true);
  assert.equal(h.ctx.PERFX.boot.length,1);
  assert.deepEqual(Array.from(h.ctx.PERFX.boot[0]),Array.from(h.ctx.BOOT_STEPS[0].slice(0,2)));
});
test('failed loading takes input ownership and offers one deliberate retry without resetting progress',()=>{
  const h=harness(),player=h.ctx.GAME.player;
  h.ctx.bootStartFailure(Error('world fixture failed'));
  assert.equal(h.errors.length,1);assert.equal(h.ctx.GAME.ready,false);assert.equal(h.ctx.window.__hm.ready,false);
  assert.equal(h.ctx.GRAPHICS_STARTUP.stopped,true);assert.equal(h.ctx.window.__hm.UI.modal,null);
  assert.equal(h.ctx.GAME.player,player);assert.equal(player.xp,37);assert.equal(h.reloads,0);
  assert.equal(h.nodes.loading.style.display,'none');assert.equal(h.nodes.nogl.hidden,false);
  assert.equal(h.nodes.nogl.attributes.role,'alert');
  const retry=h.nodes.nogl.children.find(e=>e.tag==='button');assert.equal(h.nodes.focus,retry);
  const details=h.nodes.nogl.children.find(e=>e.tag==='details');assert.equal(details.attributes.open,undefined);
  assert.equal(details.children.at(-1).textContent,'world fixture failed');
  retry.onclick();assert.equal(h.reloads,1);
});
test('existing title/context-loss recovery remains the sole failure panel',()=>{
  for(const cause of ['title','context']){
    const h=harness(),prior=[{tag:'existing recovery'}];h.nodes.nogl.children=prior;
    if(cause==='title')h.ctx.GRAPHICS_STARTUP.titleError='shader failed';else h.ctx.GRAPHICS_CONTEXT_LOST=true;
    h.ctx.bootStartFailure(Error('outer rejection'));
    assert.equal(h.nodes.nogl.children,prior);assert.equal(h.reloads,0);assert(!h.events.includes('takeover'));
  }
});
test('a missing alert surface still stops the failed game safely',()=>{
  const h=harness();delete h.nodes.nogl;
  assert.doesNotThrow(()=>h.ctx.bootStartFailure(Error('missing markup')));
  assert.equal(h.ctx.GAME.ready,false);assert.equal(h.ctx.window.__hm.ready,false);assert.equal(h.ctx.GRAPHICS_STARTUP.stopped,true);
});
