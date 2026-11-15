import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {renderCode,stateCode,layoutCode} from './fixtures/bounty_hud_view.mjs';
function fixture(){const attrs=new Set(),classes=new Set(),el={innerHTML:'',removeAttribute:k=>attrs.delete(k),
  toggleAttribute(k,on){if(on)attrs.add(k);else attrs.delete(k);},classList:{toggle(k,on){if(on)classes.add(k);else classes.delete(k);}}};
  const c=vm.createContext({$:()=>el});vm.runInContext(stateCode+'\n'+renderCode+'\nglobalThis.api={GAME,LORE,render:renderPathHud,select:s=>{selectedStep=s;},bounty:PATH_STEPS[0]};',c);
  return{c,api:c.api,el,attrs,classes};}
const other={id:'other',title:'Explore',short:'Explore',hint:()=> 'Explore',meter:()=>[.25,'1 of 4']};
test('actual active bounty renderer marks only its expanded present meter without changing earned state',()=>{
  const f=fixture(),before=JSON.stringify(f.api.GAME);f.api.render();
  assert(f.attrs.has('data-bounty-progress'));assert.match(f.el.innerHTML,/2 \/ 6 slain/);assert.match(f.el.innerHTML,/class="meter"/);
  assert.equal(JSON.stringify(f.api.GAME),before);f.api.render();assert.equal(JSON.stringify(f.api.GAME),before);
});
for(const [label,change]of[
  ['folded',f=>{f.api.LORE.min=true;}],['another selected objective',f=>f.api.select(other)],
  ['completed bounty',f=>{f.api.GAME.prog.bounty.done=true;}],['no active bounty',f=>{f.api.GAME.prog.bounty=null;}],
  ['all path steps finished',f=>f.api.select(null)],
])test(label+' does not suppress the standalone bounty card',()=>{const f=fixture();f.api.render();change(f);f.api.render();assert(!f.attrs.has('data-bounty-progress'));});
test('current progress/character replacement and missing ownership clear stale presentation markers',()=>{
  const f=fixture();f.api.render();f.api.GAME.prog={level:1,lore:{done:[]},bounty:null};f.api.render();assert(!f.attrs.has('data-bounty-progress'));
  f.api.GAME.prog.bounty={have:5,need:6,name:'boar',done:false};f.api.render();assert(f.attrs.has('data-bounty-progress'));assert.match(f.el.innerHTML,/5 \/ 6 slain/);
  f.api.GAME.player=null;f.api.render();assert(!f.attrs.has('data-bounty-progress'));
});
test('all actual HUD ordering variants resolve path before bounty; no new per-render style measurement',()=>{
  const c=vm.createContext({addEventListener(){}});vm.runInContext(layoutCode+'\nglobalThis.orders=[HUD_ORDER,HUD_ORDER_TALL,HUD_ORDER_NOTE,HUD_ORDER_NOTE_WIDE,HUD_ORDER_DESK];',c);
  for(const order of c.orders)assert(order.indexOf('#lore-path')<order.indexOf('#bounty'));
  assert(!/getComputedStyle|getBoundingClientRect|offsetHeight|offsetWidth/.test(renderCode));
});

for(const [label,value]of[['missing progress',null],['missing lore',{level:1,bounty:{have:2,need:6,done:false}}]])
  test(label+' clears a prior marker without touching existing progress',()=>{const f=fixture();f.api.render();f.api.GAME.prog=value;f.api.render();assert(!f.attrs.has('data-bounty-progress'));assert.equal(f.api.GAME.prog,value);});
