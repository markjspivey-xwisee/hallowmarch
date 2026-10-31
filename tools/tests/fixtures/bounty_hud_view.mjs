/** Source-only fixture inputs shared by CPU and DOM contracts; never runs a game. */
import {readFileSync} from 'node:fs';
import {parse} from 'acorn';
const read=name=>readFileSync(new URL('../../../'+name,import.meta.url),'utf8').replace(/\r\n/g,'\n');
const lore=read('src/10c_lore.js'),ui=read('src/10_ui.js'),hud=read('src/10p_hud.js'),shell=read('src/page.html');
function declarations(source,names){const wanted=new Set(names);return parse(source,{ecmaVersion:'latest'}).body.filter(n=>
  n.type==='FunctionDeclaration'&&wanted.has(n.id.name)||n.type==='VariableDeclaration'&&n.declarations.some(d=>wanted.has(d.id.name)))
  .map(n=>source.slice(n.start,n.end)).join('\n');}
const tree=parse(lore,{ecmaVersion:'latest'});
const steps=tree.body.find(n=>n.type==='VariableDeclaration'&&n.declarations.some(d=>d.id.name==='PATH_STEPS'))
  .declarations.find(d=>d.id.name==='PATH_STEPS').init.elements;
const bounty=steps.find(n=>n.properties.some(p=>p.key.name==='id'&&p.value.value==='bounty'));
if(!bounty)throw Error('Actual bounty step is required');
export const renderCode=declarations(lore,['renderPathHud']);
export const pathCode=declarations(lore,['buildPathHud','renderPathHud','placePathHud']);
export const loreCSSCode=declarations(lore,['LORE_CSS']);
export const bountyStepCode=lore.slice(bounty.start,bounty.end);
const b0=ui.indexOf('  // bounty\n'),b1=ui.indexOf('  updatePotionSlot();',b0);
if(b0<0||b1<b0)throw Error('Actual standalone bounty renderer is required');
export const standaloneCode='function renderStandaloneBounty(){const prog=GAME.prog;\n'+ui.slice(b0,b1)+'\n}';
export const shellCSS=[...shell.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n');
export const hudMarkup=shell.slice(shell.indexOf('<div class="frame panel" id="pf"'),shell.indexOf('<div id="topright">'))
  +shell.match(/<div class="panel" id="bounty"><\/div>/)[0];
const rts=read('src/10q_throne_rts.js');let rtsCSS='';
function walk(node){if(!node||typeof node!=='object')return;
  if(node.type==='AssignmentExpression'&&node.left?.property?.name==='textContent'&&node.right?.type==='TemplateLiteral'
    &&!node.right.expressions.length){const text=node.right.quasis.map(q=>q.value.cooked).join('');if(text.includes('body.throne-rts-open #hud'))rtsCSS=text;}
  for(const value of Object.values(node))if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value);}
walk(parse(rts,{ecmaVersion:'latest'}));if(!rtsCSS)throw Error('Actual RTS visibility CSS is required');
export {rtsCSS};
export const layoutCode=declarations(hud,['HUDL','HUD_PREF','HUD_ORDER','HUD_ORDER_TALL','HUD_ORDER_NOTE','HUD_ORDER_NOTE_WIDE',
  'HUD_ORDER_DESK','HUD_COMPACT','HUD_HIDE','hudShown','hudRect','hudHit','hudUnion','hudSafe','hudMove','hudReset','hudKey',
  'hudLayout','HUDL5','HUD_HOLD','HUD_WATCH','hudWatch','hudHeld']);
export const stateCode=`
const GAME={started:true,player:{faction:0},prog:{level:1,lore:{done:[]},bounty:{have:2,need:6,name:'boar',done:false}}};
const LORE={min:false,hudKey:'',top:-1};const REALMS=[{name:'Ériu',townName:'Bracken'}];
const PATH_STEPS=[${bountyStepCode}];let selectedStep=PATH_STEPS[0];const IS_TOUCH=false;
const esc=value=>String(value),pluralName=name=>name==='boar'?'wild boars':name+'s';
const LK=()=>({map:'M',use:'press E'}),bountyAvailable=()=>false,pathNext=()=>selectedStep;
const rewardLabel=()=>({ic:'',t:'Authored reward'}),iconSvg=()=>'',guideWhereLine=()=>'',g2PointerLine=()=>'',water2PathLine=()=>'';
const guideAims=()=>[],guideShortWhere=()=>'',loreLvlFrac=()=>0,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const sfx=()=>{},openChronicle=()=>{},g2TapHeld=()=>false,BUILD={mode:false};let renderTime=1;
`;
