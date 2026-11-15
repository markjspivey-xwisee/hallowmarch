import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('../../src/10q_throne_rts.js',import.meta.url),'utf8');
function extract(name) {
  const start=source.indexOf('function '+name+'('), end=source.indexOf('\nfunction ',start);
  assert.ok(start>=0 && end>start,name);
  return source.slice(start,end);
}
function fixture() {
  const ledger={revision:7,population:{workers:18},buildings:[
    {id:'mill-1',kind:'mill',label:'Mill',status:'built',workers:4,assigned:3,priority:2},
    {id:'quarry-2',kind:'quarry',label:'Quarry',status:'built',workers:3,assigned:1,priority:0},
  ]};
  const state={root:{},tab:'production',key:'',form:{},quoteForm:{},selectedPlot:'',revision:null};
  const nodes={'rts-content':{innerHTML:'',contains:()=>false},'rts-title':{},'rts-tabs':{querySelectorAll:()=>[]}};
  const commands=[],notices=[];
  const scope=vm.createContext({THRONE_RTS:{active:true},THRONE_RTS_UI:state,UI:{modal:'rts'},
    GAME:{player:{faction:0}},REALMS:[{name:'Realm'}],HALL:{sit:{H:{S:{name:'Keep'}}}},CWUI:{},
    document:{activeElement:null},$:id=>nodes[id],hallThroneGrant:()=>true,throneRtsView:()=>ledger,
    throneRtsNotice:message=>notices.push(message),netRealmManagementCommand:action=>commands.push({...action})});
  vm.runInContext(['throneRtsEscape','throneRtsNumber','throneRtsForm','throneRtsCost','throneRtsOptions',
    'throneRtsProduction','throneRtsRenderPanel','throneRtsManage','throneRtsClick'].map(extract).join('\n'),scope);
  const render=()=>scope.throneRtsRenderPanel(true);
  const displayed=id=>{
    const card=[...nodes['rts-content'].innerHTML.matchAll(/<article class="rts-card">([\s\S]*?)<\/article>/g)]
      .find(match=>match[1].includes(`data-workforce="${id}"`))?.[1];
    assert.ok(card,'the production card is rendered');
    const workers=new RegExp(`name="workers-${id}" value="([^"]*)"`).exec(card)?.[1];
    const priority=new RegExp(`<select name="priority-${id}">([\\s\\S]*?)<\\/select>`).exec(card)?.[1]
      .match(/<option value="([^"]*)" selected>/)?.[1];
    return {workers:Number(workers),priority:Number(priority)};
  };
  const click=id=>scope.throneRtsClick({target:{closest:()=>({dataset:{workforce:id},disabled:false,classList:{contains:()=>false}})}});
  return {ledger,state,commands,notices,render,displayed,click};
}

test('untouched workforce orders preserve the requested workers and priority shown for each building',()=>{
  const f=fixture();f.render();
  for(const id of ['mill-1','quarry-2']){
    const displayed=f.displayed(id);f.click(id);
    assert.deepEqual(f.commands.at(-1),{type:'workforce',buildingId:id,...displayed});
  }
  assert.deepEqual(f.commands.map(command=>command.workers),[4,3],'requested workers are distinct from currently assigned workers');
  assert.deepEqual(f.commands.map(command=>command.priority),[2,0]);
});

test('changing one workforce field preserves the other displayed field and allows explicit zero values',()=>{
  for(const form of [{'workers-mill-1':'1'},{'priority-mill-1':'0'},{'workers-mill-1':'0','priority-mill-1':'0'}]){
    const f=fixture();Object.assign(f.state.form,form);f.render();
    const displayed=f.displayed('mill-1');f.click('mill-1');
    assert.deepEqual(f.commands[0],{type:'workforce',buildingId:'mill-1',...displayed});
  }
});

test('untouched workforce fields follow the latest rendered canonical building values',()=>{
  const f=fixture();f.render();
  Object.assign(f.ledger.buildings[0],{workers:2,priority:0});f.ledger.revision++;f.render();
  assert.deepEqual(f.displayed('mill-1'),{workers:2,priority:0});f.click('mill-1');
  assert.deepEqual(f.commands[0],{type:'workforce',buildingId:'mill-1',workers:2,priority:0});
});

test('a stale workforce view refreshes before dispatching the newly displayed values',()=>{
  const f=fixture();f.render();Object.assign(f.ledger.buildings[0],{workers:5,priority:0});f.ledger.revision++;
  f.click('mill-1');assert.equal(f.commands.length,0);assert.equal(f.notices.length,1);
  assert.deepEqual(f.displayed('mill-1'),{workers:5,priority:0});f.click('mill-1');
  assert.deepEqual(f.commands[0],{type:'workforce',buildingId:'mill-1',workers:5,priority:0});
});
