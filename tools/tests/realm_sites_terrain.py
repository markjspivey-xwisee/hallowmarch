"""Offline built-world audit and deterministic realm plot authoring.

Authoring reads the fresh local world's terrain, static collision layout and
natural objects. Rendering uses an explicit local character and canonical
management fixtures; no live account, shared world or existing user save is used.
--author emits a candidate catalog for review; the default verifies the compiled
v2 catalog, both historical/current foundations, actual shaders and touch UI.
Outputs are isolated with HM_REALM_SITE_OUT; --screenshots saves reviewed views.
"""
import argparse, asyncio, hashlib, json, os, pathlib, sys
from contextlib import asynccontextmanager

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = pathlib.Path(os.environ.get('HM_REALM_SITE_OUT', str(ROOT.parent / 'realm-site-qa')))
OUT.mkdir(parents=True, exist_ok=True)
os.environ['HM_OUT'] = str(OUT)
sys.path.insert(0, str(ROOT / 'tools'))
import hm
from hmlib import wait_title_settled, human_play
from playwright.async_api import async_playwright


@asynccontextmanager
async def audit_browser(playwright, args):
    if not args.native_edge:
        browser=await playwright.chromium.launch(args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        try: yield browser
        finally: await browser.close()
        return
    from native_journey_browser import NativeJourneyBrowser
    owner=NativeJourneyBrowser(OUT, lifetime=900)
    browser=None
    try:
        endpoint=await owner.start()
        browser=await playwright.chromium.connect(endpoint)
        yield browser
    finally:
        try:
            if browser: await asyncio.wait_for(browser.close(),timeout=20)
        finally:
            await owner.stop()
            (OUT/'native-browser-receipt.json').write_text(json.dumps(owner.receipt,indent=2),encoding='utf-8')

HOOK = r"""
window.__realmSiteQA = (() => {
  const HALF_SITE=6, PAD=.8, CELL=24, bins=new Map(), obstacles=[];
  const box=(x,z,hx,hz,yaw,tag)=>({x,z,hx,hz,c:Math.cos(yaw),s:Math.sin(yaw),tag});
  const circle=(x,z,r,tag)=>({x,z,r,tag});
  function add(o){
    const radius=o.r??Math.hypot(o.hx,o.hz); o.radius=radius; obstacles.push(o);
    for(let ix=Math.floor((o.x-radius)/CELL);ix<=Math.floor((o.x+radius)/CELL);ix++)
      for(let iz=Math.floor((o.z-radius)/CELL);iz<=Math.floor((o.z+radius)/CELL);iz++){
        const key=ix+','+iz; if(!bins.has(key))bins.set(key,[]); bins.get(key).push(o);
      }
  }
  function near(x,z,rad){const found=new Set();
    for(let ix=Math.floor((x-rad)/CELL);ix<=Math.floor((x+rad)/CELL);ix++)
      for(let iz=Math.floor((z-rad)/CELL);iz<=Math.floor((z+rad)/CELL);iz++)
        for(const o of bins.get(ix+','+iz)||[])found.add(o);
    return found;
  }
  function overlap(A,B,pad=PAD){
    const dx=B.x-A.x,dz=B.z-A.z;
    if(B.r!=null){const u=dx*A.c-dz*A.s,v=dx*A.s+dz*A.c;
      return Math.hypot(Math.max(0,Math.abs(u)-A.hx),Math.max(0,Math.abs(v)-A.hz))<B.r+pad;}
    for(const [ax,az] of [[A.c,-A.s],[A.s,A.c],[B.c,-B.s],[B.s,B.c]]){
      const a=A.hx*Math.abs(A.c*ax-A.s*az)+A.hz*Math.abs(A.s*ax+A.c*az);
      const b=B.hx*Math.abs(B.c*ax-B.s*az)+B.hz*Math.abs(B.s*ax+B.c*az);
      if(Math.abs(dx*ax+dz*az)>=a+b+pad)return false;
    }return true;
  }
  function pointSegment(x,z,a,b,c,d){const dx=c-a,dz=d-b,q=dx*dx+dz*dz;
    const t=q?Math.max(0,Math.min(1,((x-a)*dx+(z-b)*dz)/q)):0;return Math.hypot(x-a-t*dx,z-b-t*dz);}
  const legacy=[],crownRadii={};
  function crownRadius(kind){
    if(crownRadii[kind])return crownRadii[kind];
    const geometries=[0,1,2].map(l=>treeGeometry(kind,l));
    const nearGeo=NEAR_TREES.kinds[kind]?.mesh.geometry;
    let radius=0;
    for(const geo of [...geometries,...(nearGeo?[nearGeo]:[])]){
      const p=geo.getAttribute('position');for(let i=0;i<p.count;i++)radius=Math.max(radius,Math.hypot(p.getX(i),p.getZ(i)));
    }
    geometries.forEach(g=>g.dispose());
    return crownRadii[kind]=radius+.3; // sway allowance beyond the exact geometry
  }
  function init(){
    bins.clear();obstacles.length=0;legacy.length=0;
    for(const o of [...COLL.boxes,...COLL.circles])if(o.active!==false){
      const shape=o.type==='box'?box(o.x,o.z,o.hx,o.hz,o.yaw,o.tag):circle(o.x,o.z,o.r,o.tag);
      shape.physical=true;add(shape);
    }
    for(const t of W.trees)add(circle(t.x,t.z,Math.max(.8,t.s*crownRadius(t.kind)),'tree-crown'));
    for(const r of W.rocks)add(circle(r.x,r.z,r.s*1.15,'natural-rock'));
    for(const s of W.stones)add(circle(s.x,s.z,s.s,'standing-stone'));
    for(const S of SITES){
      // Enclose entire interiors as well as their existing wall colliders.
      for(const h of S.houses||[])add(box(h.x,h.z,h.w/2+1,h.d/2+1,h.yaw,'house-interior'));
      if(S.kind==='keep')add(circle(S.x,S.z,30,'keep-reserved'));
      if(S.kind==='town')add(circle(S.x,S.z,38,'town-reserved'));
    }
    for(const p of FARM.plots)add(box(p.x,p.z,p.hw,p.hd,p.ang,'farm-plot'));
    for(let home=0;home<3;home++){
      const a=REALMS[home].bearing,dx=Math.sin(a),dz=-Math.cos(a),yaw=REALMS[home].town.yaw;
      const place=(along,lat)=>({x:dx*along-dz*lat,z:dz*along+dx*lat});
      for(let i=0;i<16;i++){const p=place(432+Math.floor(i/4)*18,[-63,-39,39,63][i%4]);legacy.push(box(p.x,p.z,6,6,yaw,'legacy-town'));}
    }
    for(let k=0;k<6;k++)for(let i=0;i<4;i++){
      const home=Math.floor(k/2),a=REALMS[home].bearing,dx=Math.sin(a),dz=-Math.cos(a);
      const along=[-28,-28,28,28][i],lat=[-26,26,-26,26][i];
      legacy.push(box(RSM_GEO.keep[k][0]+dx*along-dz*lat,RSM_GEO.keep[k][1]+dz*along+dx*lat,6,6,REALMS[home].town.yaw,'legacy-keep'));
    }
    legacy.forEach(add);
  }
  // Independent barycentric height from the actual built high-detail triangles.
  // The gameplay height function bilinearly interpolates a cell instead.
  function renderedHeight(x,z){
    const ci=Math.max(0,Math.min(7,Math.floor((x+HALF)/128))),cj=Math.max(0,Math.min(7,Math.floor((z+HALF)/128)));
    const m=terrainChunks[cj*8+ci],geo=LOD.terrain[cj*8+ci]?.gs[0]||m.geometry;
    const pos=geo.getAttribute('position'),index=geo.getIndex();
    const fx=(x+HALF-ci*128)/2,fz=(z+HALF-cj*128)/2,i=Math.min(63,Math.floor(fx)),j=Math.min(63,Math.floor(fz));
    const start=(j*64+i)*6;
    for(let t=0;t<2;t++){
      const a=index.getX(start+t*3),b=index.getX(start+t*3+1),c=index.getX(start+t*3+2);
      const ax=pos.getX(a),az=pos.getZ(a),bx=pos.getX(b),bz=pos.getZ(b),cx=pos.getX(c),cz=pos.getZ(c);
      const den=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);
      const u=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/den,v=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/den,w=1-u-v;
      if(u>=-1e-6&&v>=-1e-6&&w>=-1e-6)return u*pos.getY(a)+v*pos.getY(b)+w*pos.getY(c);
    }throw Error('No rendered terrain triangle at '+x+','+z);
  }
  // Clip the actual terrain triangles to the rotated footprint. Their extrema
  // occur at the clipped polygon vertices, so this detects peaks between the
  // gameplay sampler's points, including retained historical mountain sites.
  function exactSurface(row,level=0){
    const yaw=REALMS[row.home].town.yaw,c=Math.cos(yaw),s=Math.sin(yaw),extent=6*(Math.abs(c)+Math.abs(s));
    const ci0=Math.max(0,Math.floor((row.x-extent+HALF)/128)),ci1=Math.min(7,Math.floor((row.x+extent+HALF)/128));
    const cj0=Math.max(0,Math.floor((row.z-extent+HALF)/128)),cj1=Math.min(7,Math.floor((row.z+extent+HALF)/128));
    let min=Infinity,max=-Infinity,triangles=0;
    const clip=(poly,axis,sign)=>{
      const out=[];for(let i=0;i<poly.length;i++){
        const a=poly[i],b=poly[(i+1)%poly.length],av=sign*a[axis]-6,bv=sign*b[axis]-6,ain=av<=1e-8,bin=bv<=1e-8;
        if(ain)out.push(a);
        if(ain!==bin){const t=av/(av-bv);out.push(a.map((v,k)=>v+(b[k]-v)*t));}
      }return out;
    };
    const geometries=[];
    if(level===3){
      for(const B of LOD.blocks)if(row.x+extent>=-HALF+B.bi*256&&row.x-extent<=-HALF+(B.bi+1)*256
        &&row.z+extent>=-HALF+B.bj*256&&row.z-extent<=-HALF+(B.bj+1)*256)geometries.push(B.m.geometry);
    }else for(let cj=cj0;cj<=cj1;cj++)for(let ci=ci0;ci<=ci1;ci++)geometries.push(LOD.terrain[cj*8+ci]?.gs[level]||terrainChunks[cj*8+ci].geometry);
    for(const geo of geometries){
      const p=geo.attributes.position.array,idx=geo.index.array;
      for(let i=0;i<idx.length;i+=3){
        const a=idx[i]*3,b=idx[i+1]*3,d=idx[i+2]*3;
        if(Math.max(p[a],p[b],p[d])<row.x-extent||Math.min(p[a],p[b],p[d])>row.x+extent
          ||Math.max(p[a+2],p[b+2],p[d+2])<row.z-extent||Math.min(p[a+2],p[b+2],p[d+2])>row.z+extent)continue;
        let poly=[a,b,d].map(k=>{const dx=p[k]-row.x,dz=p[k+2]-row.z;return[dx*c-dz*s,dx*s+dz*c,p[k+1]];});
        for(const [axis,sign]of [[0,1],[0,-1],[1,1],[1,-1]]){poly=clip(poly,axis,sign);if(!poly.length)break;}
        if(poly.length){triangles++;for(const point of poly){min=Math.min(min,point[2]);max=Math.max(max,point[2]);}}
      }
    }return {min,max,triangles};
  }
  function audit(row,{maxSpan=1.2,maxSlope=.35,full=false}={}){
    const yaw=REALMS[row.home].town.yaw,A=box(row.x,row.z,HALF_SITE,HALF_SITE,yaw,'candidate');
    for(const o of near(row.x,row.z,10))if(overlap(A,o))return {ok:false,reason:o.tag};
    const roads=(W.roads||[]).filter(r=>pointSegment(A.x,A.z,r.ax,r.az,r.bx,r.bz)<10+r.w);
    let min=Infinity,max=-Infinity,renderMin=Infinity,renderMax=-Infinity,maxDelta=0,slope=0;
    const heights=[];
    for(let iz=-6;iz<=6;iz++)for(let ix=-6;ix<=6;ix++){
      const x=A.x+ix*A.c+iz*A.s,z=A.z-ix*A.s+iz*A.c;
      if(realmAt(x,z)!==row.home)return {ok:false,reason:'outside-home-realm'};
      if(Math.hypot(x,z)>=440)return {ok:false,reason:'outer-hills'};
      const h=heightAt(x,z),k=(iz+6)*13+ix+6;
      if(!Number.isFinite(h)||h<=WATER_Y+.6||waterAt(x,z))return {ok:false,reason:'water'};
      if(!isWalkable(x,z))return {ok:false,reason:'unwalkable'};
      if(sampleGrid(W.road,x,z)>.12)return {ok:false,reason:'road-cover'};
      for(const r of roads)if(pointSegment(x,z,r.ax,r.az,r.bx,r.bz)<=r.w+PAD)return {ok:false,reason:'road'};
      heights[k]=h;min=Math.min(min,h);max=Math.max(max,h);
      if(ix>-6)slope=Math.max(slope,Math.abs(h-heights[k-1]));
      if(iz>-6)slope=Math.max(slope,Math.abs(h-heights[k-13]));
      if(max-min>maxSpan||slope>maxSlope)return {ok:false,reason:'slope'};
      if(full){const rh=renderedHeight(x,z);renderMin=Math.min(renderMin,rh);renderMax=Math.max(renderMax,rh);maxDelta=Math.max(maxDelta,Math.abs(rh-h));}
    }
    return {ok:true,min,max,span:max-min,slope,...(full?{renderMin,renderMax,maxBilinearDelta:maxDelta}:{}),yaw};
  }
  function author(townRadius=100){init();const rows={},groups=[],selected=[];
    for(let group=0;group<9;group++){
      const town=group<3,home=town?group:Math.floor((group-3)/2),k=group-3;
      const R=REALMS[home],center=town?R.town:{x:RSM_GEO.keep[k][0],z:RSM_GEO.keep[k][1]},need=town?16:4;
      const radius=town&&home===0?townRadius:100;
      const candidates=[],reasons={};
      for(let along=-radius;along<=radius;along+=2)for(let lat=-radius;lat<=radius;lat+=2){
        const dist=Math.hypot(along,lat);if(dist>(town?radius:85)||dist<(town?43:40))continue;
        const row={x:Math.round((center.x+R.dx*along+R.px*lat)*100)/100,z:Math.round((center.z+R.dz*along+R.pz*lat)*100)/100,home};
        const result=audit(row);if(!result.ok){reasons[result.reason]=(reasons[result.reason]||0)+1;continue;}
        candidates.push({...row,...result,along,lat,dist,score:result.span*4+result.slope*4+dist*.004});
      }
      candidates.sort((a,b)=>a.score-b.score||a.x-b.x||a.z-b.z);
      let chosen=[];
      // Several deterministic packing orders avoid throwing away a valid small
      // clearing because a low-slope point happened to split it in two.
      for(let trial=0;trial<100;trial++){
        const rand=mulberry(8100+group*101+trial),order=trial?candidates.map(p=>({p,s:p.score+rand()*5})).sort((a,b)=>a.s-b.s).map(q=>q.p):candidates;
        const trialChosen=[];
        for(const p of order){const A=box(p.x,p.z,6,6,R.town.yaw,'candidate');
          if([...selected,...trialChosen].some(q=>overlap(A,box(q.x,q.z,6,6,REALMS[q.home].town.yaw,'selected'),1.2)))continue;
          trialChosen.push(p);if(trialChosen.length===need)break;
        }
        if(trialChosen.length>chosen.length)chosen=trialChosen;
        if(chosen.length===need)break;
      }
      selected.push(...chosen);
      chosen.sort((a,b)=>a.along-b.along||a.lat-b.lat);
      chosen.forEach((p,i)=>{const id=(town?'town:'+home:'keep:'+k)+':'+i;rows[id]={x:p.x,z:p.z,home,siteKind:town?'town':'keep'};});
      groups.push({site:town?'town:'+home:'keep:'+k,needed:need,found:chosen.length,candidates:candidates.length,reasons,chosen});
    }
    return {version:2,townRadius,footprintHalf:6,obstaclePadding:PAD,plotPadding:1.2,sampleStep:1,maxSpan:1.2,maxSlope:.35,crownRadii,legacyCount:legacy.length,rows,groups};
  }
  function normalize(rows){return Object.fromEntries(Object.entries(rows).map(([id,row])=>[id,{...row,
    home:id.startsWith('town:')?Number(id.split(':')[1]):Math.floor(Number(id.split(':')[1])/2),siteKind:id.split(':')[0]}]));}
  function connectivity(rows){
    const answer={};
    for(let home=0;home<3;home++){
      const town=REALMS[home].town,half=96,n=2*half+1,x0=Math.round(town.x/2)*2-half*2,z0=Math.round(town.z/2)*2-half*2;
      const tested=new Uint8Array(n*n),seen=new Uint8Array(n*n),distance=new Int32Array(n*n),queue=[];
      const pass=(i,j)=>{
        if(i<0||j<0||i>=n||j>=n)return false;const key=j*n+i;if(tested[key])return tested[key]===1;
        const x=x0+i*2,z=z0+j*2,A=box(x,z,.4,.4,0,'walker');
        const ok=realmAt(x,z)===home&&isWalkable(x,z)&&!waterAt(x,z)&&heightAt(x,z)>WATER_Y+.35
          &&![...near(x,z,1)].some(o=>o.physical&&overlap(A,o,0));
        tested[key]=ok?1:2;return ok;
      };
      const si=Math.round((town.x-x0)/2),sj=Math.round((town.z-z0)/2),start=sj*n+si;
      if(pass(si,sj)){queue.push(start);seen[start]=1;}
      for(let q=0;q<queue.length;q++){
        const key=queue[q],i=key%n,j=Math.floor(key/n),h=heightAt(x0+i*2,z0+j*2);
        for(let di=-1;di<=1;di++)for(let dj=-1;dj<=1;dj++){
          if(!di&&!dj)continue;const ni=i+di,nj=j+dj,nk=nj*n+ni;
          if(!pass(ni,nj)||seen[nk]||di&&dj&&(!pass(i+di,j)||!pass(i,j+dj)))continue;
          if(Math.abs(heightAt(x0+ni*2,z0+nj*2)-h)>.9)continue;
          seen[nk]=1;distance[nk]=distance[key]+1;queue.push(nk);
        }
      }
      for(const [id,row]of Object.entries(rows))if(row.siteKind==='town'&&row.home===home){
        const i=Math.round((row.x-x0)/2),j=Math.round((row.z-z0)/2),key=j*n+i;
        answer[id]={reachable:!!seen[key],routeSteps:seen[key]?distance[key]:null,gridStep:2,townDistance:Math.hypot(row.x-town.x,row.z-town.z)};
      }
    }return answer;
  }
  function validate(rawRows){init();const rows=normalize(rawRows),results=[],entries=Object.entries(rows);
    const access=connectivity(rows);
    for(const [id,row]of entries){const detail=audit(row,{full:true}),surface=[0,1,2].map(l=>exactSurface(row,l));
      const A=box(row.x,row.z,6,6,REALMS[row.home].town.yaw,'candidate');
      const overlaps=entries.filter(([other,q])=>other!==id&&overlap(A,box(q.x,q.z,6,6,REALMS[q.home].town.yaw,'other'),1.2)).map(([other])=>other);
      const runtime=typeof realmRtsSiteStatus==='function'?realmRtsSiteStatus({id,...row,owner:row.home,placementAvailable:true}):null;
      results.push({id,...row,...detail,surface,overlaps,access:access[id]||null,runtime});
    }
    const controls={legacy:audit({...legacy[0],home:0}),tree:audit({...W.trees[0],home:realmAt(W.trees[0].x,W.trees[0].z)}),lake:audit({...LAKES[0],home:0})};
    return {count:entries.length,legacyCount:legacy.length,crownRadii,results,controls,obstacles:obstacles.length,trees:W.trees.length,rocks:W.rocks.length,farms:FARM.plots.length};
  }
  function foundations(rawRows){
    // Retain the full-envelope oracle for all fourteen original models. The
    // watchpost has an entrance ramp and is audited by its real walking route.
    const rows=normalize(rawRows),kinds=Object.keys(REALM_RTS_MODEL_HEIGHT).filter(kind=>kind!=='watchpost'),matrix=new THREE.Matrix4(),vertex=new THREE.Vector3();
    const plots=Object.entries(rows).map(([id,row])=>({id,...row,owner:(row.home+1)%3}));
    const surfaces=plots.map(row=>{const lods=[0,1,2,3].map(level=>exactSurface(row,level));
      return {min:Math.min(...lods.map(s=>s.min)),max:Math.max(...lods.map(s=>s.max)),lods};});
    realmRtsModelsInit();
    const failures=[],stages=[['building',0],['building',.14],['building',.15],['building',.5],['building',.99],['built',1],['upgrading',.99]];
    for(const [status,progress]of stages){
      const buildings=plots.map((p,i)=>({...p,id:'b:'+p.id,plotId:p.id,kind:kinds[i%kinds.length],level:status==='upgrading'?3:4,status,progress}));
      realmRtsModelsRebuild(plots,buildings);
      const mesh=REALM_RTS_MODELS.pools.get('foundation');
      if(mesh.count!==plots.length)failures.push({status,reason:'foundation-count',count:mesh.count});
      for(let i=0;i<buildings.length;i++){
        const b=buildings[i],ground=realmRtsSiteGround(b),surface=surfaces[i],c=Math.cos(REALMS[b.home].yaw),s=Math.sin(REALMS[b.home].yaw);
        mesh.getMatrixAt(i,matrix);let minY=Infinity,maxY=-Infinity,maxHalf=0;
        const pos=mesh.geometry.attributes.position;
        for(let v=0;v<pos.count;v++){
          vertex.fromBufferAttribute(pos,v).applyMatrix4(matrix);minY=Math.min(minY,vertex.y);maxY=Math.max(maxY,vertex.y);
          const dx=vertex.x-b.x,dz=vertex.z-b.z;maxHalf=Math.max(maxHalf,Math.abs(dx*c-dz*s),Math.abs(dx*s+dz*c));
        }
        if(minY>surface.min+.005||maxY<surface.max+.005||maxHalf<5.99||maxHalf>6.01)
          failures.push({id:b.plotId,status,progress,minY,maxY,maxHalf,surface,ground});
        const yaw=Math.atan2(-matrix.elements[2],matrix.elements[0]);
        if(Math.abs(Math.atan2(Math.sin(yaw-REALMS[b.home].yaw),Math.cos(yaw-REALMS[b.home].yaw)))>1e-6)
          failures.push({id:b.plotId,status,reason:'captured-building-yaw',yaw});
      }
    }
    const count=REALM_RTS_MODELS.group.children.length;
    for(let i=0;i<20;i++)realmRtsModelsRebuild(plots,[]);
    if(count!==REALM_RTS_MODELS.group.children.length)failures.push({reason:'rebuild-growth'});
    realmRtsModelsClear();
    return {plots:plots.length,stages:stages.length,failures};
  }
  function legacyRows(){
    const RS=realmSimInit(314159);realmManageInit(RS);
    return Object.fromEntries(rmLegacyPlots(RS).map(p=>[p.id,p]));
  }
  let fixture=null;
  function installFixture(){
    const RS=realmSimInit(314159);realmManageInit(RS);const kinds=Object.keys(RM_CATALOG).filter(kind=>kind!=='watchpost');
    for(let home=0;home<3;home++){
      RS.realms[home].management.buildings=[];
      for(let i=0;i<8;i++){
        const b=rmBuilding('town:'+home+':'+i,kinds[(home*8+i)%kinds.length]);
        Object.assign(b,{placementVersion:2,level:3,status:i===3?'building':'built',remaining:i===3?b.total*.5:0});
        RS.realms[home].management.buildings.push(b);
      }
    }
    fixture={RS,commands:0};NETS.s={...(NETS.s||{}),management:realmManageView(RS,0)};
    // Only the confirmed remote management view and outbound command port are
    // fixtures. The seat grant, camera, UI, renderer and touch handlers are real.
    netRealmManagementView=()=>NETS.s.management;
    netRealmManagementCommand=()=>{fixture.commands++;throw Error('Read-only visual fixture attempted a commission');};
    window.requestAnimationFrame=()=>0; // explicit manual draws, no clock sleeps
    return {buildings:NETS.s.management.publicBuildings.length};
  }
  function selectRealm(home){
    if(THRONE_RTS.active)closeThroneRTS(false);HALL.sit=null;
    const P=GAME.player;P.faction=home;P.hp=P.maxHp;P.casting=null;UI.modal=null;
    NETS.s.management=realmManageView(fixture.RS,home);
    const H=HOUSES.find(h=>h.hallSpots?.seat&&hallHolder(h)===home&&houseIntact(h)&&h.state!=='burning');
    if(!H)throw Error('No intact local high seat for realm '+home);
    THRONE_RTS_UI.tab='build';THRONE_RTS_UI.form={};THRONE_RTS_UI.key='';
    P.x=H.hallSpots.seat.x;P.z=H.hallSpots.seat.z;P.y=H.y;
    hallSitConfirmed(H);if(!THRONE_RTS.active)throw Error('Real high-seat UI did not open');
    const plot=NETS.s.management.plots.find(p=>p.id===THRONE_RTS_UI.form.plotId);
    if(!plot)throw Error('Construction selector has no eligible plot');
    throneRtsFocus(plot.x,plot.z);THRONE_RTS.distance=THRONE_RTS.targetDistance=65;
    throneRtsUpdateCamera(0);realmRtsModelsFrame(.1);throneRtsDrawMarkers();
    return {realm:home,plot:plot.id,seated:!!hallThroneGrant()};
  }
  function draw(quality,night=false){
    setQuality(quality);tod.p=tod.fixedP=night?2.1:.25;tod.mode='fixed';applyTimeOfDay(tod.p);
    applyWeather();applyIndoor();resize();
    if(THRONE_RTS.active)throneRtsUpdateCamera(0);
    updateLod();drawHouses(0);realmRtsModelsFrame(0);if(THRONE_RTS.active)throneRtsDrawMarkers();
    camera.updateMatrixWorld();renderer.setRenderTarget(null);renderer.info.reset();renderer.render(scene,camera);gl.finish();
    const programs=renderer.info.programs.map(p=>{
      const source=gl.getShaderSource(p.vertexShader)||'';
      return source.includes('vGroundMark')?{instanced:source.includes('#define USE_INSTANCING'),linked:gl.getProgramParameter(p.program,gl.LINK_STATUS)}:null;
    }).filter(Boolean);
    return {quality,night,nightUniform:U.uNight.value,programs,errors:HM_ERRORS.slice(),glError:gl.getError(),calls:renderer.info.render.calls,
      outlines:!!REALM_RTS_MODELS.plots,foundations:REALM_RTS_MODELS.pools.get('foundation')?.count||0,
      commands:fixture.commands,camera:{x:camera.position.x,y:camera.position.y,z:camera.position.z}};
  }
  function phoneState(){
    const rect=$('rts-stage').getBoundingClientRect(),P=GAME.player;
    return {active:THRONE_RTS.active,mode:CAM.mode,selected:THRONE_RTS_UI.selectedPlot,
      selector:document.querySelector('[name=plotId]')?.value,focus:{x:THRONE_RTS.x,z:THRONE_RTS.z},
      distance:THRONE_RTS.targetDistance,player:{x:P.x,z:P.z},stage:{x:rect.x,y:rect.y,w:rect.width,h:rect.height},commands:fixture.commands};
  }
  function focusOtherPlot(){
    const plot=NETS.s.management.plots.find(p=>!p.buildingId&&p.id!==THRONE_RTS_UI.selectedPlot&&realmRtsSiteStatus(p).eligible);
    if(!plot)throw Error('No second clear plot');throneRtsFocus(plot.x,plot.z);throneRtsUpdateCamera(0);throneRtsDrawMarkers();return plot.id;
  }
  function armPhoneTap(x,y,target){
    const events=[],picks=[],original=throneRtsPick;
    const label=e=>({tag:e?.tagName||'',id:e?.id||'',marker:e?.dataset?.id||''});
    const point={x,y,target,hits:document.elementsFromPoint(x,y).slice(0,6).map(label),
      markers:THRONE_RTS_UI.markers.filter(m=>m.screen).map(m=>({kind:m.kind,id:m.id,screen:{...m.screen},distance:Math.hypot(m.screen.x-x,m.screen.y-y)})).sort((a,b)=>a.distance-b.distance).slice(0,5)};
    const observe=e=>{if(events.length<24)events.push({type:e.type,trusted:e.isTrusted,at:performance.now(),stamp:e.timeStamp,x:e.clientX,y:e.clientY,id:e.pointerId,target:label(e.target),pointers:THRONE_RTS.pointers.size});};
    const types=['pointerdown','pointerup','pointercancel','lostpointercapture'];
    for(const type of types)window.addEventListener(type,observe,true);
    throneRtsPick=function(px,py){const before=THRONE_RTS_UI.selectedPlot;try{return original.apply(this,arguments);}finally{picks.push({x:px,y:py,before,after:THRONE_RTS_UI.selectedPlot});}};
    fixture.tap={point,events,picks,restore(){for(const type of types)window.removeEventListener(type,observe,true);throneRtsPick=original;}};
    return point;
  }
  function phoneTapReceipt(){const tap=fixture.tap;return {point:tap.point,events:tap.events,picks:tap.picks,state:phoneState(),
    focused:document.hasFocus(),hidden:document.hidden,live:netHumanLive(),grant:!!hallThroneGrant(),now:performance.now()};}
  function stopPhoneTap(){const receipt=phoneTapReceipt();fixture.tap.restore();return receipt;}
  function walking(){
    closeThroneRTS(true);UI.modal=null;CAM.mode='fixed';realmRtsModelsFrame(.1);
    const b=NETS.s.management.publicBuildings.find(b=>b.owner===GAME.player.faction&&!b.adopted),ground=realmRtsSiteGround(b);
    camera.clearViewOffset();camera.position.set(b.x+14,ground.top+3,b.z+14);camera.lookAt(b.x,ground.top+2,b.z);camera.updateMatrixWorld();
    return {outlines:!!REALM_RTS_MODELS.plots,seated:!!HALL.sit,commands:fixture.commands};
  }
  function prepareTerrain(){
    // Title rendering intentionally precedes the first active-frame LOD build.
    // Build the real presentation variants before claiming three-LOD coverage.
    if(!LOD.built)lodBuild();
    return {built:LOD.built,chunks:LOD.terrain.length,threeLods:LOD.terrain.every(t=>t.gs.length===3)};
  }
  function coldTransition(){
    const started=GAME.started,prior=NETS.s,beforeLOD=LOD.built;
    try{
      const p=legacyRows()['town:0:15'],b={...p,id:'b:'+p.id,plotId:p.id,owner:1,kind:'mine',level:4,status:'built',progress:1};
      GAME.started=true;NETS.s={management:{publicPlots:[],publicBuildings:[b]}};
      realmRtsModelsFrame(.1);
      if(!LOD.built)lodBuild();
      // Same ledger object and no terrain revision: readiness alone must cause
      // the real frame hook to replace the first sampled-height foundation.
      realmRtsModelsFrame(.3);
      const matrix=new THREE.Matrix4(),vertex=new THREE.Vector3(),mesh=REALM_RTS_MODELS.pools.get('foundation');
      mesh.getMatrixAt(0,matrix);let minY=Infinity,maxY=-Infinity;
      const pos=mesh.geometry.attributes.position;for(let i=0;i<pos.count;i++){
        vertex.fromBufferAttribute(pos,i).applyMatrix4(matrix);minY=Math.min(minY,vertex.y);maxY=Math.max(maxY,vertex.y);
      }
      const lods=[0,1,2,3].map(l=>exactSurface(p,l)),surface={min:Math.min(...lods.map(s=>s.min)),max:Math.max(...lods.map(s=>s.max))};
      return {beforeLOD,afterLOD:LOD.built,minY,maxY,surface,ok:minY<=surface.min+.005&&maxY>=surface.max+.005};
    }finally{realmRtsModelsClear();GAME.started=started;NETS.s=prior;}
  }
  return {author,validate,foundations,legacyRows,normalize,renderedHeight,exactSurface,installFixture,selectRealm,draw,phoneState,focusOtherPlot,armPhoneTap,phoneTapReceipt,stopPhoneTap,walking,
    prepareTerrain,coldTransition,catalog:()=>typeof RM_PLOT_LAYOUT_V2==='undefined'?{}:RM_PLOT_LAYOUT_V2};
})();
"""

async def render_suite(page, args):
    await page.evaluate("(async()=>{await __hm.start({realm:0,cls:'warrior',level:1,name:'Offline terrain QA'});__hm.UI.modal=null;return true})()")
    await human_play(page)
    await page.evaluate('__realmSiteQA.installFixture()')
    phases=[]
    for realm in range(3):
        await human_play(page)
        seat=await page.evaluate('(realm)=>__realmSiteQA.selectRealm(realm)',realm)
        assert seat['seated'], seat
        for quality in ['high','medium','low']:
            for night in [False,True]:
                await human_play(page)
                result=await page.evaluate('([q,night])=>__realmSiteQA.draw(q,night)',[quality,night])
                result['realm']=realm
                assert result['outlines'] and result['foundations']>0, result
                assert {p['instanced'] for p in result['programs']}=={False,True}, result
                assert all(p['linked'] for p in result['programs']), result
                assert result['nightUniform']>.9 if night else result['nightUniform']<.1, result
                assert not result['errors'] and not result['glError'] and result['commands']==0, result
                phases.append(result)
                (OUT/'render-phases.json').write_text(json.dumps(phases,indent=2),encoding='utf-8')
                print(json.dumps({'draw':{'realm':realm,'quality':quality,'night':night,'variants':len(result['programs']),'calls':result['calls']}}),flush=True)
                if args.screenshots:
                    name=f'realm-{realm}-{quality}-'+('night' if night else 'day')+'.png'
                    await page.screenshot(path=str(OUT/name),timeout=300000)
    await page.set_viewport_size({'width':390,'height':780})
    await human_play(page)
    await page.evaluate('__realmSiteQA.selectRealm(0)')
    await page.evaluate("__realmSiteQA.draw('low',false)")
    target=await page.evaluate('__realmSiteQA.focusOtherPlot()')
    await page.evaluate("__realmSiteQA.draw('low',false)")
    marker=await page.locator(f'[data-marker="plot"][data-id="{target}"]').bounding_box()
    assert marker, f'Focused plot marker {target} is not visible'
    # Markers deliberately pass pointer events to the 3D stage. A real touch at
    # the marker's screen centre exercises the stage's nearest-marker picker.
    tap_x=marker['x']+marker['width']/2;tap_y=marker['y']+marker['height']/2
    await page.evaluate('([x,y,target])=>__realmSiteQA.armPhoneTap(x,y,target)',[tap_x,tap_y,target])
    try:
        await page.touchscreen.tap(tap_x,tap_y)
        # The protocol command's acknowledgement alone is not an application
        # receipt. Observe this one real gesture; never retry or inject events.
        await page.wait_for_function("__realmSiteQA.phoneTapReceipt().events.some(e=>e.type==='pointerup'||e.type==='pointercancel')",timeout=3000)
        await page.wait_for_function("target=>{const s=__realmSiteQA.phoneState();return s.selected===target&&s.selector===target}",arg=target,timeout=3000)
    finally:
        tap_receipt=await page.evaluate('__realmSiteQA.stopPhoneTap()')
        (OUT/'phone-selection-receipt.json').write_text(json.dumps(tap_receipt,indent=2),encoding='utf-8')
    before=await page.evaluate('__realmSiteQA.phoneState()')
    assert before['selected']==target and before['selector']==target, {'target':target,'marker':marker,'before':before,'receipt':tap_receipt}
    assert before['active'] and before['mode']=='rts' and before['stage']['w']>100 and before['stage']['h']>80, before
    stage=before['stage'];x=stage['x']+stage['w']*.5;y=stage['y']+stage['h']*.72
    cdp=await page.context.new_cdp_session(page)
    await cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x,'y':y,'id':1}]})
    await cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x+32,'y':y-18,'id':1}]})
    await cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
    dragged=await page.evaluate('__realmSiteQA.phoneState()')
    assert dragged['focus']!=before['focus'] and dragged['player']==before['player'], {'before':before,'dragged':dragged}
    await cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x-25,'y':y,'id':1},{'x':x+25,'y':y,'id':2}]})
    await cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x-55,'y':y,'id':1},{'x':x+55,'y':y,'id':2}]})
    await cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
    pinched=await page.evaluate('__realmSiteQA.phoneState()')
    assert pinched['distance']<dragged['distance'] and pinched['player']==before['player'], {'dragged':dragged,'pinched':pinched}
    await page.evaluate("__realmSiteQA.draw('low',false)")
    if args.screenshots:await page.screenshot(path=str(OUT/'phone-construction.png'),timeout=300000)
    await page.set_viewport_size({'width':1000,'height':650})
    walk=await page.evaluate('__realmSiteQA.walking()')
    assert not walk['outlines'] and not walk['seated'] and walk['commands']==0, walk
    result=await page.evaluate("__realmSiteQA.draw('low',false)")
    assert not result['outlines'] and not result['errors'] and not result['glError'], result
    if args.screenshots:await page.screenshot(path=str(OUT/'walking-no-plot-borders.png'),timeout=300000)
    return {'phases':phases,'phone':{'selected':before,'dragged':dragged,'pinched':pinched},'walking':walk}


async def run(args):
    source_bytes=pathlib.Path(args.html).read_bytes()
    compiled_sha=hashlib.sha256(source_bytes).hexdigest()
    source=source_bytes.decode('utf-8')
    cut = source.rfind('</script>')
    if cut < 0: raise RuntimeError('Built page has no script boundary')
    source = source[:cut] + '\n' + HOOK + '\n' + source[cut:]
    async with async_playwright() as p, audit_browser(p,args) as browser:
        ctx = await browser.new_context(viewport={'width':1000,'height':650},has_touch=True)
        page = await ctx.new_page()
        errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.on('console',lambda m:errors.append(m.text) if m.type=='error' and any(t in m.text.lower() for t in ['shader error','webglprogram','error linking','error validating']) else None)
        async def local_only(route):
            url=route.request.url
            if url==hm.THREE_URL:
                await route.fulfill(status=200,content_type='application/javascript',body=hm.THREE_LOCAL.read_text(),headers={'Access-Control-Allow-Origin':'*'})
            elif url=='http://hm.test/':
                await route.fulfill(status=200,content_type='text/html',body=hm.SKELETON.replace('%s',source))
            elif url.startswith(('https://fonts.googleapis.com/','https://fonts.gstatic.com/')):
                await route.fulfill(status=200,content_type='text/css',body='')
            else: await route.abort()
        await page.route('**/*',local_only)
        await page.goto('http://hm.test/',wait_until='commit')
        await page.wait_for_function('window.__hm?.ready && window.__realmSiteQA',timeout=180000,polling=500)
        await page.evaluate("__hm.fn.setQuality('low')")
        await wait_title_settled(page)
        cold=None if args.author else await page.evaluate('__realmSiteQA.coldTransition()')
        terrain=await page.evaluate('__realmSiteQA.prepareTerrain()')
        assert terrain['built'] and terrain['chunks']==64 and terrain['threeLods'], terrain
        if args.author:
            report=await page.evaluate('(radius)=>__realmSiteQA.author(radius)',args.town_radius)
            (OUT/'catalog-v2.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
            print(json.dumps({'author':[{k:g[k] for k in ['site','found','needed','candidates']} for g in report['groups']]}),flush=True)
            rows=report['rows']
        elif args.catalog:
            catalog=json.loads(pathlib.Path(args.catalog).read_text(encoding='utf-8'))
            rows=catalog.get('rows',catalog)
        else: rows=await page.evaluate('__realmSiteQA.catalog()')
        audit=await page.evaluate('(rows)=>__realmSiteQA.validate(rows)',rows)
        audit['compiledSha256']=compiled_sha
        audit['terrain']=terrain
        audit['coldTransition']=cold
        if not args.author:
            audit['foundations']=await page.evaluate('(rows)=>({current:__realmSiteQA.foundations(rows),legacy:__realmSiteQA.foundations(__realmSiteQA.legacyRows())})',rows)
            if not args.geometry_only:
                (OUT/'geometry-audit.json').write_text(json.dumps(audit,indent=2),encoding='utf-8')
                try:audit['rendering']=await render_suite(page,args)
                except Exception as error:
                    audit['renderFailure']=str(error)
                    (OUT/'geometry-audit.json').write_text(json.dumps(audit,indent=2),encoding='utf-8')
                    raise
        audit['pageErrors']=errors
        (OUT/'geometry-audit.json').write_text(json.dumps(audit,indent=2),encoding='utf-8')
        failures=[r for r in audit['results'] if not r.get('ok') or r['overlaps'] or r['access'] and not r['access']['reachable'] or r['runtime'] and not r['runtime']['eligible']]
        print(json.dumps({'count':audit['count'],'failures':failures,'pageErrors':errors,'maxSpan':max((r.get('span',0) for r in audit['results']),default=0),'maxSlope':max((r.get('slope',0) for r in audit['results']),default=0),'report':str(OUT/'geometry-audit.json')}),flush=True)
        await browser.close()
        assert audit['count']==72, f'Expected 72 plots; got {audit["count"]}'
        expected={f'town:{home}:{index}' for home in range(3) for index in range(16)} | {f'keep:{keep}:{index}' for keep in range(6) for index in range(4)}
        assert {r['id'] for r in audit['results']}==expected, 'The stable 72 plot IDs changed'
        assert all(not r['ok'] for r in audit['controls'].values()), 'An unsafe real-world control was accepted'
        assert not failures, f'{len(failures)} unsafe plots'
        assert not cold or cold['ok'], f'Cold LOD transition retained a sampled-height foundation: {cold}'
        assert not any(r['failures'] for r in audit.get('foundations',{}).values()), 'Actual foundation geometry does not enclose rendered terrain'
        assert not errors, errors

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--html',default=str(hm.HTML))
    parser.add_argument('--catalog')
    parser.add_argument('--author',action='store_true')
    parser.add_argument('--town-radius',type=int,default=100)
    parser.add_argument('--screenshots',action='store_true')
    parser.add_argument('--geometry-only',action='store_true',help='Skip shader, Construction UI and touch checks')
    parser.add_argument('--native-edge',action='store_true',help='Use one owned headless Edge with default GPU/security protections for a serialized local audit')
    asyncio.run(run(parser.parse_args()))
