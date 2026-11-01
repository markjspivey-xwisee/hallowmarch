import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../src/10_ui.js', import.meta.url), 'utf8');
const body = name => {
  const start = source.indexOf('function ' + name + '(');
  assert(start >= 0);
  const end = source.indexOf('\n}', start);
  assert(end > start);
  return source.slice(start, end + 2);
};
const drawStart = source.indexOf('function drawMinimap() {');
const drawEnd = source.indexOf("  const ctx = cv.getContext('2d');", drawStart);
assert(drawEnd > drawStart);
const drawSize = source.slice(drawStart, drawEnd) + '\nreturn cv.width;\n}';

function fixture({observer = true} = {}) {
  const counts = new Map(), observers = [];
  const canvas = width => {
    const cv = {isConnected:true, width:186, height:186, actualWidth:width};
    Object.defineProperty(cv, 'clientWidth', {get() {counts.set(cv, (counts.get(cv) || 0) + 1); return cv.actualWidth;}});
    return cv;
  };
  let current = canvas(186);
  const elements = {hud:{hidden:true}, log:{innerHTML:''}};
  const context = vm.createContext({UI:{mapImg:{}, hudBound:true}, IS_TOUCH:false,
    GAME:{player:{}}, innerWidth:1280, innerHeight:800, window:{devicePixelRatio:1},
    $:id => id === 'minimap' ? current : elements[id],
    buildHotbar() {}, updateWarPanel() {},
    ResizeObserver: observer ? class {
      constructor(callback) {this.callback=callback;this.disconnected=false;observers.push(this);}
      observe(cv) {this.canvas=cv;}
      disconnect() {this.disconnected=true;}
    } : undefined});
  vm.runInContext(body('minimapObserveSize') + '\n' + body('buildHUD') + '\n' + drawSize, context);
  return {context, observers, canvas, reads:cv => counts.get(cv) || 0,
    get current() {return current;}, replace(cv) {current=cv;},
    build:() => vm.runInContext('buildHUD()', context),
    draw:() => vm.runInContext('drawMinimap()', context),
    deliver:(index=observers.length-1, entries) => observers[index].callback(entries || [{target:observers[index].canvas}])};
}

test('HUD registration performs no layout read; a delivered size serves later draws', () => {
  const f=fixture();f.build();
  assert.equal(f.observers.length,1);assert.equal(f.reads(f.current),0);
  f.deliver();assert.equal(f.reads(f.current),1);
  for(let i=0;i<4;i++)assert.equal(f.draw(),186);
  assert.equal(f.reads(f.current),1);
});

test('an immediate entry retains the original current-width fallback', () => {
  const f=fixture();f.current.actualWidth=203;f.build();
  assert.equal(f.draw(),203);assert.equal(f.current.height,203);assert.equal(f.reads(f.current),1);
});

test('viewport and pixel-ratio changes cannot consume an old measurement', () => {
  const f=fixture();f.build();f.deliver();
  f.context.innerWidth=390;f.current.actualWidth=144;
  assert.equal(f.draw(),144);assert.equal(f.reads(f.current),2);
  f.deliver();assert.equal(f.draw(),144);assert.equal(f.reads(f.current),3);
  f.context.window.devicePixelRatio=2;
  assert.equal(f.draw(),288);assert.equal(f.current.height,288);assert.equal(f.reads(f.current),4);
});

test('a rebuilt HUD invalidates its old size until the observer delivers again', () => {
  const f=fixture();f.build();f.deliver();f.current.actualWidth=160;f.build();
  assert.equal(f.observers.length,1);assert.equal(f.draw(),160);
  f.deliver();const before=f.reads(f.current);assert.equal(f.draw(),160);assert.equal(f.reads(f.current),before);
});

test('replaced or disconnected canvases and unrelated entries cannot populate the cache', () => {
  const f=fixture();f.build();const old=f.current;const replacement=f.canvas(174);f.replace(replacement);
  f.deliver(0);assert.equal(f.reads(old),0);
  assert.equal(f.draw(),174);assert.equal(f.observers[0].disconnected,true);assert.equal(f.observers.length,2);
  f.deliver(1,[{target:old}]);assert.equal(f.reads(replacement),1);
  replacement.isConnected=false;f.deliver(1);assert.equal(f.reads(replacement),1);
  replacement.isConnected=true;f.deliver(1);assert.equal(f.reads(replacement),2);
  assert.equal(f.draw(),174);assert.equal(f.reads(replacement),2);
});

test('a hidden zero-size delivery is not reused when the canvas becomes visible', () => {
  const f=fixture();f.current.actualWidth=0;f.build();f.deliver();f.current.actualWidth=198;
  assert.equal(f.draw(),198);assert.equal(f.reads(f.current),2);
});

test('browsers without ResizeObserver keep ordinary current-width sizing', () => {
  const f=fixture({observer:false});f.current.actualWidth=215;f.build();
  assert.equal(f.observers.length,0);assert.equal(f.reads(f.current),0);assert.equal(f.draw(),215);
  f.current.actualWidth=0;assert.equal(f.draw(),186);
});
