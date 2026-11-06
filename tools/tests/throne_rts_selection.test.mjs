import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {THREE,read,extract,uiSource,modelSource,oracle,selectionFixture,walkFixture} from './throne_rts_selection_fixture.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
test('the original d5 sources are exact controls, including the stale focused selector witness',()=>{
  assert.equal(sha(oracle.sources['src/10q_throne_rts.js']),'80639be85081f4af20069293c283250ddc425873eb71ef2498a1d840589d82f3');
  assert.equal(sha(oracle.sources['src/10r_realm_models.js']),'4ec7db85074838c59b264f19371d74dd8f58f0b60090a55f67b5c5bccb499dfb');
  const f=selectionFixture({baseline:true}),before=f.nodes['rts-content'].innerHTML;
  f.change('buildKind','sawmill');f.scope.throneRtsRenderPanel();
  assert.equal(f.state.form.buildKind,'sawmill');assert.equal(f.nodes['rts-content'].innerHTML,before);
  assert.equal(f.state.quoteForm.buildKind,'mill');assert.match(before,/<b>Mill<\/b>/);assert.equal(f.commands.length,0);
});
test('a committed focused building choice refreshes its real details and quote without replacing either selector',()=>{
  const f=selectionFixture(),node=f.kindSelect,plot=f.plotSelect,options=[...node.options],writes=node.innerHTMLWrites;
  f.change('buildKind','sawmill');
  assert.equal(f.document.activeElement,node);assert.equal(f.kindSelect,node);assert.equal(f.plotSelect,plot);
  assert.equal(node.innerHTMLWrites,writes,'a stale serialized selected attribute must not recreate an unchanged catalog');
  assert(node.options.every((option,i)=>option===options[i]),'all existing native option identities survive');
  assert.match(f.detail.innerHTML,/<b>Sawmill<\/b>/);assert.match(f.detail.innerHTML,/60 seconds · 3 workers/);
  assert.match(f.detail.innerHTML,/Preview|preview/);assert.equal(f.state.quoteForm.buildKind,'sawmill');
  f.scope.throneRtsManage({type:'build',plotId:'town:1:0',kind:'sawmill'});assert.equal(f.commands.length,1);
});
test('plot changes filter the actual catalog, explain excluded types, and preserve focused native plot selection',()=>{
  const f=selectionFixture();f.change('plotId','keep:0:0');
  assert.equal(f.document.activeElement,f.plotSelect);assert.equal(f.state.selectedPlot,'keep:0:0');
  assert.doesNotMatch(f.kindSelect.innerHTML,/value="mill"/);assert.match(f.kindSelect.innerHTML,/value="watchpost"/);
  assert.match(f.detail.innerHTML,/Mill: Town sites only/);assert.match(f.detail.innerHTML,/Keep east/);
  f.change('plotId','town:1:0');assert.doesNotMatch(f.kindSelect.innerHTML,/value="watchpost"/);assert.equal(f.commands.length,0);
});
test('any existing same-keep watchpost including construction blocks a duplicate but not another keep',()=>{
  const f=selectionFixture();f.ledger.publicBuildings.push({kind:'watchpost',plotId:'keep:0:9',paused:true,status:'building'});
  f.change('plotId','keep:0:0');assert.doesNotMatch(f.kindSelect.innerHTML,/value="watchpost"/);assert.match(f.detail.innerHTML,/already has a Watchpost/);
  const item=f.ledger.catalog.find(c=>c.id==='watchpost');
  assert.equal(f.scope.throneRtsBuildReason(item,{id:'keep:1:0',site:'keep:1'},f.ledger),'');
});
test('maximum level one suppresses Watchpost upgrade cost and action, with ordinary level-three upgrades retained',()=>{
  const f=selectionFixture();f.ledger.buildings.push({id:'w',kind:'watchpost',level:1,upgradeCost:{stone:99}},{id:'s',kind:'sawmill',level:1,upgradeCost:{timber:10}});
  const html=f.scope.throneRtsConstruction(f.ledger);
  assert.match(html,/data-upgrade="w" disabled>Maximum level/);assert.match(html,/data-upgrade="s">Upgrade building/);
  assert.doesNotMatch(html,/99 stone/);
});
test('explicitly selecting the default site reports preview state without commissioning; invalid markers retain it',()=>{
  const f=selectionFixture();assert.equal(f.scope.throneRtsSelectPlot('town:1:0'),true);
  assert.match(f.notices.at(-1),/Selected Town west.*Preview only/);assert.equal(f.commands.length,0);
  f.scope.throneRtsSelectPlot('missing');assert.equal(f.state.selectedPlot,'town:1:0');
  f.blocked.set('keep:0:0','Tree in the site');assert.equal(f.scope.throneRtsSelectPlot('keep:0:0'),false);
  assert.equal(f.state.selectedPlot,'town:1:0');assert.match(f.notices.at(-1),/Tree/);
});
for(const yaw of [0,Math.PI/2,.37])test('ground footprint picking uses actual perspective projection and rotated edge geometry: '+yaw,()=>{
  const f=selectionFixture();const p=f.ledger.plots[0];p.yaw=yaw;
  const polygon=f.scope.throneRtsPlotPolygon(p);assert.equal(polygon.length,48);
  const c=Math.cos(yaw),s=Math.sin(yaw),point=f.screen(p.x+5.3*c+5.3*s,p.z-5.3*s+5.3*c),centre=f.screen(p.x,p.z);
  assert(Math.hypot(point.x-centre.x,point.y-centre.y)>30,'fixture must exercise the footprint, not centre fallback');
  assert(f.scope.throneRtsPointInPolygon(point.x,point.y,polygon));
  f.state.selectedPlot='';f.state.form.plotId='';f.state.markers=[];f.scope.throneRtsPick(point.x,point.y);
  assert.equal(f.state.selectedPlot,p.id);assert.equal(f.commands.length,0);
});
test('footprint picking rejects outside-stage and unavailable plots and preserves existing marker priority',()=>{
  const f=selectionFixture(),point=f.screen(5,5);f.state.selectedPlot='';f.state.form.plotId='';
  f.scope.throneRtsPick(-10,point.y);assert.equal(f.state.selectedPlot,'');
  f.blocked.set('town:1:0','Occupied');f.scope.throneRtsPick(point.x,point.y);assert.equal(f.state.selectedPlot,'');
  f.blocked.clear();f.state.markers=[{kind:'canonical',id:'army',screen:point}];
  f.scope.throneRtsPick(point.x,point.y);assert.deepEqual(f.actions,[['focus','army']]);assert.equal(f.state.selectedPlot,'');
});
test('projection refuses behind-camera footprints instead of guessing a screen box',()=>{
  const f=selectionFixture();f.scope.screenOf=()=>null;
  assert.equal(f.scope.throneRtsPlotPolygon(f.ledger.plots[0]),null);
  f.state.selectedPlot='';f.state.form.plotId='';f.scope.throneRtsPick(400,300);assert.equal(f.state.selectedPlot,'');
});
test('selection updates preserve actual marker identity/focus and publish pressed state plus an explicit preview',()=>{
  const f=selectionFixture();f.scope.throneRtsDrawMarkers();
  const host=f.nodes['rts-markers'],first=host.children.find(n=>n.dataset.id==='town:1:0');
  f.document.activeElement=first;f.scope.throneRtsSelectPlot('keep:0:0');f.scope.throneRtsDrawMarkers();
  assert.equal(host.children.find(n=>n.dataset.id==='town:1:0'),first);assert.equal(f.document.activeElement,first);
  assert.equal(first.attributes['aria-pressed'],'false');const selected=host.children.find(n=>n.dataset.id==='keep:0:0');
  assert.equal(selected.attributes['aria-pressed'],'true');assert.match(selected.attributes['aria-label'],/Selected/);
  assert.match(f.nodes['rts-routes'].innerHTML,/class="rts-plot-preview"/);assert.match(f.nodes['rts-routes'].innerHTML,/Preview: Sawmill/);
  f.change('buildKind','watchpost');f.scope.throneRtsDrawMarkers();assert.match(f.nodes['rts-routes'].innerHTML,/Preview: Watchpost/);
  assert.equal(f.commands.length,0);
});
test('the fourteen original model factories and emitted geometry attributes retain exact bytes',()=>{
  const before=vm.createContext({THREE}),after=vm.createContext({THREE});
  for(const [scope,source] of [[before,oracle.sources['src/10r_realm_models.js']],[after,modelSource]])vm.runInContext(extract(source,'realmRtsModelParts')+'\n'+extract(source,'realmRtsModelGeometry'),scope);
  const bases={box:new THREE.BoxGeometry(1,1,1).toNonIndexed(),cyl:new THREE.CylinderGeometry(1,1,1,8).toNonIndexed(),taper:new THREE.CylinderGeometry(.7,1,1,8).toNonIndexed(),cone:new THREE.ConeGeometry(1,1,8).toNonIndexed(),sphere:new THREE.SphereGeometry(1,8,5).toNonIndexed()};
  vm.runInContext(extract(modelSource,'realmRtsModelRoofGeometry'),after);bases.roof=after.realmRtsModelRoofGeometry();
  for(const kind of ['farm','mill','bakery','woodcutter','sawmill','sheepfold','weaver','mine','toolmaker','quarry','hunter','stables','house','market']) {
    const a=before.realmRtsModelParts(kind),b=after.realmRtsModelParts(kind);assert.equal(JSON.stringify(a),JSON.stringify(b),kind);
    const ga=before.realmRtsModelGeometry(a,bases),gb=after.realmRtsModelGeometry(b,bases);
    for(const name of ['position','normal','color'])assert(Buffer.from(ga.attributes[name].array.buffer).equals(Buffer.from(gb.attributes[name].array.buffer)),kind+' '+name);
    ga.dispose();gb.dispose();
  }
  for(const base of Object.values(bases))base.dispose();
});
for(const yaw of [0,Math.PI/2,.37])test('actual registered floors and collision resolver allow outside-ramp-stairs-deck-return at yaw '+yaw,()=>{
  const f=walkFixture({yaw}),solid=f.state.solids.get('post'),ground=f.context.realmRtsSiteGround(f.b);
  assert.equal(solid.parts.filter(p=>p.floor&&p.bounds.walkable).length,9);
  const up=f.walk(6.3,-1.8);
  for(const sample of up){assert(Math.hypot(sample.p.x-sample.want.x,sample.p.z-sample.want.z)<1e-7,'collision-free actual access');assert(Math.abs(sample.next-sample.y)<=.62,'no forced jump or teleport');}
  assert(Math.abs(up.at(-1).next-(ground.top+2))<1e-6,'real deck floor at2m');
  const down=f.walk(-1.8,6.3,up.at(-1).next);for(const sample of down)assert(Math.hypot(sample.p.x-sample.want.x,sample.p.z-sample.want.z)<1e-7);
  assert(down.at(-1).next<ground.top+.1);f.clear();assert.equal(f.context.COLL.boxes.length,0);assert.equal(f.context.floors.list.length,0);
});
test('construction floors follow actual visual progress and become full-height only when complete',()=>{
  const f=walkFixture({progress:.5,height:()=>0}),item=f.state.solids.get('post'),deck=item.parts.find(p=>p.bounds.walkable&&p.bounds.max.y===2);
  assert.equal(deck.floor.ya,1.06);assert.equal(deck.floor.active,true);
  f.b.progress=1;f.b.status='built';f.frame();const up=f.walk(6.3,-1.8);assert(Math.abs(up.at(-1).next-2.06)<1e-6);
  assert(!f.state.solids.get('post').parts.some(p=>p.scaffold));f.clear();
});
test('removal and ground rebuild retire every owned ramp mesh, floor and collider without accumulation',()=>{
  const f=walkFixture(),old=f.state.solids.get('post'),ramp=old.ramp;let disposed=0;ramp.geometry.addEventListener('dispose',()=>disposed++);
  const count=f.context.floors.list.length;f.context.A2FL.ground++;f.b.x+=1;f.frame();
  assert.equal(disposed,1);assert.notEqual(f.state.solids.get('post').ramp,ramp);assert.equal(f.context.floors.list.length,count);
  f.context.NETS.s.management.publicBuildings=[];f.frame();assert.equal(f.state.solids.size,0);assert.equal(f.context.floors.list.length,0);assert.equal(f.context.COLL.boxes.length,0);
  assert(!f.scene.getObjectByName('realm-watchpost-access'));f.clear();
});
test('Watchpost production card names support and food requirements without implying active defense or goods output',()=>{
  const f=selectionFixture();
  vm.runInContext(extract(uiSource,'throneRtsProduction')+'\n'+extract(oracle.sources['src/10q_throne_rts.js'],'throneRtsProduction').replace('function throneRtsProduction(','function originalProduction('),f.scope);
  const description='A defensive watchtower supports existing keep troops when staffed and supplied. It does not fire on its own.';
  const building={id:'post',kind:'watchpost',status:'built',working:true,level:1,inputs:{food:.5},outputs:{},workers:2,assigned:2,priority:1};
  const view={catalog:[{id:'watchpost',label:'Watchpost',description}],buildings:[building],population:{workers:12}};
  const html=f.scope.throneRtsProduction(view),old=f.scope.originalProduction(view);
  assert.match(html,/>Watchpost · Lv 1<\/button>/);assert.match(html,/<p>Working<\/p>/);assert(html.includes(description));
  assert.match(html,/Food requirement: 0\.5 food per minute/);assert.match(html,/Staffing and supply support the keep; no goods are produced/);
  assert.doesNotMatch(html,/Producing|→|No materials|active.{0,15}10%|10%.{0,15}active/i);
  const controls='<p>2 workers assigned';assert.equal(html.slice(html.indexOf(controls)),old.slice(old.indexOf(controls)),'workers, priority and pause controls remain literal');
  for(const [value,label] of [['inputs:food','Needs provisions'],['workforce','Needs two workers'],['construction','Under construction'],['unknown:reason','unknown:reason'],['constructor','constructor'],['inputs:food:extra','inputs:food:extra']]) {
    building.blocked=value;assert(f.scope.throneRtsProduction(view).includes('<p>'+label+'</p>'),'actual canonical blocked state '+value);
  }
  building.blocked='';building.paused=true;assert.match(f.scope.throneRtsProduction(view),/<p>Paused<\/p>/);
  const ordinary={catalog:[{id:'mill',label:'Mill'}],buildings:[{...building,id:'mill',kind:'mill',label:'Mill',paused:false,inputs:{grain:3},outputs:{flour:3}}]};
  assert.equal(f.scope.throneRtsProduction(ordinary),f.scope.originalProduction(ordinary),'ordinary goods production remains unchanged');
  ordinary.buildings[0].blocked='inputs:food';assert.equal(f.scope.throneRtsProduction(ordinary),f.scope.originalProduction(ordinary),'other kinds retain canonical status text');
});
test('emitted Watchpost uprights meet deck and canopy underside without protrusion, rejecting the old low roof',()=>{
  const scope=vm.createContext({THREE});
  vm.runInContext(['realmRtsModelParts','realmRtsModelGeometry','realmRtsModelRoofGeometry'].map(name=>extract(modelSource,name)).join('\n'),scope);
  const bases={box:new THREE.BoxGeometry(1,1,1).toNonIndexed(),roof:scope.realmRtsModelRoofGeometry()};
  const bounds=part=>{const geometry=scope.realmRtsModelGeometry([part],bases);geometry.computeBoundingBox();const result={box:geometry.boundingBox.clone(),positions:Array.from(geometry.attributes.position.array)};geometry.dispose();return result;};
  const parts=scope.realmRtsModelParts('watchpost'),deck=parts.find(p=>p.walkable&&p.sx>4),canopy=parts.find(p=>p.shape==='roof');
  assert(deck&&canopy);const deckTop=bounds(deck).box.max.y,roof=bounds(canopy).box;
  const upright=parts.filter(p=>p.shape==='box'&&p.sx<.3&&p.sz<.3&&p.sy>2);
  assert.equal(upright.length,4);
  const fits=(part,cover=roof)=>{const emitted=bounds(part);return Math.abs(emitted.box.min.y-deckTop)<1e-6&&Math.abs(emitted.box.max.y-cover.min.y)<1e-6
    &&emitted.positions.every((value,index)=>index%3===0?value>=cover.min.x&&value<=cover.max.x:index%3===2?value>=cover.min.z&&value<=cover.max.z:value<=cover.min.y+1e-6);};
  for(const part of upright)assert(fits(part),'actual emitted support starts on deck and ends at canopy underside inside its footprint');
  const lowRoof=bounds({...canopy,y:5}).box;
  for(const part of upright)assert.equal(fits(part,lowRoof),false,'the old emitted roof underside must fail the same support-contact invariant');
  for(const base of Object.values(bases))base.dispose();
});
test('emitted stilts support the deck and the canopy clears the actual normal unmounted jump envelope',()=>{
  const f=walkFixture({height:()=>0}),scope=f.context,parts=scope.realmRtsModelParts('watchpost');
  const bodyMatrix=new THREE.Matrix4(),baseMatrix=new THREE.Matrix4();
  f.state.pools.get('watchpost').getMatrixAt(0,bodyMatrix);const base=f.state.pools.get('watchpost-base');base.getMatrixAt(0,baseMatrix);
  base.geometry.computeBoundingBox();const foundation=base.geometry.boundingBox.clone().applyMatrix4(baseMatrix);
  const bases={box:new THREE.BoxGeometry(1,1,1).toNonIndexed(),roof:scope.realmRtsModelRoofGeometry()};
  const bounds=part=>{const g=scope.realmRtsModelGeometry([part],bases);g.computeBoundingBox();const b=g.boundingBox.clone().applyMatrix4(bodyMatrix);g.dispose();return b;};
  const deck=parts.find(p=>p.walkable&&p.sx>4),canopy=parts.find(p=>p.shape==='roof'),deckBox=bounds(deck),roof=bounds(canopy);
  const stilts=parts.filter(p=>p.shape==='box'&&p.sx<.3&&p.sz<.3&&p.sy>1&&p.sy<2);
  assert.equal(stilts.length,4);assert.equal(new Set(stilts.map(p=>p.x+':'+p.z)).size,4);
  for(const stilt of stilts){const b=bounds(stilt);assert(Math.abs(b.min.y-foundation.max.y)<1e-6,'stilt starts at actual emitted foundation top');assert(Math.abs(b.max.y-deckBox.min.y)<1e-6,'stilt meets actual emitted deck underside');}
  const player=extract(read('09_player.js'),'updatePlayer');
  const launch=[...player.matchAll(/P\.vy = P\.mount \? ([0-9.]+) : ([0-9.]+); P\.onGround = false;/g)];
  const gravity=[...player.matchAll(/P\.vy -= ([0-9.]+) \* dt;\s*P\.y \+= P\.vy \* dt;/g)];
  const body=[...read('04g_castles.js').matchAll(/const FLOOR_STEP = [0-9.]+, FLOOR_BODY = ([0-9.]+);/g)];
  assert.equal(launch.length,1);assert.equal(gravity.length,1);assert.equal(body.length,1);
  const speed=Number(launch[0][2]),g=Number(gravity[0][1]),bodyHeight=Number(body[0][1]);
  assert(speed>0&&g>0&&bodyHeight>0);const required=speed*speed/(2*g)+bodyHeight;
  assert(roof.min.y-deckBox.max.y>required,'continuous-rise bound is conservative for the actual gravity-before-position integrator');
  assert(bounds({...canopy,y:5}).min.y-deckBox.max.y<required,'the previous low canopy fails the same normal-jump clearance bound');
  // This is the normal unmounted envelope only; mounted movement is not validated.
  for(const geometry of Object.values(bases))geometry.dispose();f.clear();
});
test('committed construction choices immediately refresh the actual selection status with focus and quote intact',()=>{
  const f=selectionFixture();f.change('plotId','keep:0:0');
  assert.match(f.status,/Selected Keep east · Sawmill/);
  const select=f.kindSelect,options=[...select.options];f.change('buildKind','watchpost');
  assert.match(f.status,/Selected Keep east · Watchpost/);assert.doesNotMatch(f.status,/Sawmill/);
  assert.equal(f.document.activeElement,select);assert(select.options.every((option,i)=>option===options[i]));
  assert.equal(f.state.quoteForm.buildKind,'watchpost');assert.match(f.detail.innerHTML,/Watchpost/);assert.equal(f.commands.length,0);
  f.change('plotId','town:1:0');assert.match(f.status,/Selected Town west/);assert.doesNotMatch(f.status,/Keep east|Watchpost/);
  assert.equal(f.document.activeElement,f.plotSelect);assert.equal(f.state.quoteForm.plotId,'town:1:0');assert.equal(f.commands.length,0);
});
test('selection feedback never masks pending, reply or validation notices and is retired when an order starts',()=>{
  for(const status of [{pending:true,result:null,message:'Waiting for the native realm save…'},
    {pending:false,result:{ok:true,confirmed:true},message:'Realm order confirmed.'},
    {pending:false,result:{ok:false,confirmed:false},message:'Realm order refused.'}]) {
    const f=selectionFixture();f.scope.throneRtsSelectPlot('keep:0:0');Object.assign(f.netStatus,status);
    f.scope.updateThroneRTS(0);assert.equal(f.status,status.message,'normal status frame must not retain the old selection over an order');
    f.change('buildKind','watchpost');assert.equal(f.status,status.message);assert.equal(f.state.quoteForm.buildKind,'watchpost');
    assert.equal(f.document.activeElement,f.kindSelect);assert.equal(f.commands.length,0);
  }
  const validation=selectionFixture();validation.scope.throneRtsSelectPlot('keep:0:0');validation.scope.throneRtsNotice('Review the updated costs.');
  validation.change('buildKind','watchpost');assert.equal(validation.status,'Review the updated costs.');assert.equal(validation.state.quoteForm.buildKind,'watchpost');
  validation.advance(8001);validation.change('buildKind','sawmill');assert.match(validation.status,/Selected Keep east · Sawmill/);
  const paid=selectionFixture();paid.scope.throneRtsSelectPlot('keep:0:0');paid.change('buildKind','watchpost');
  paid.scope.netRealmManagementCommand=command=>{paid.commands.push(command);Object.assign(paid.netStatus,{pending:true,message:'Waiting for the native realm save…'});};
  paid.scope.throneRtsManage({type:'build',plotId:'keep:0:0',kind:'watchpost'});
  assert.equal(paid.commands.length,1);assert.equal(paid.status,paid.netStatus.message);assert.equal(paid.state.notice,'');
  assert.equal(paid.state.noticeKind,'');
});
