/* ================================================================== */
/* lore: the prologue, the Chronicle, your path, field notes, tips     */
/* ================================================================== */
// Everything that tells a player what the March is and what to do next. This module makes its own
// styles and markup; the shared files only call in: startGame -> loreOnStart, tick -> updateLore,
// renderMenu -> renderChronicle, buildSave and coreKey -> char.lore. window.__hm.LORE is attached
// at the bottom of this file, once the debug API exists.

/* ------------------------------------------------------------------ */
/* styles                                                              */
/* ------------------------------------------------------------------ */
const LORE_CSS = `
@keyframes lore-in { from { opacity: 0; transform: translateY(8px); } }
@keyframes lore-art { from { opacity: 0; transform: scale(1.03); } }
@keyframes lore-tw { 0%, 100% { opacity: 0.2; } 50% { opacity: 1; } }
@keyframes lore-pulse { 0%, 100% { opacity: 0.6; } 50% { opacity: 1; } }
@keyframes lore-flag { from { transform: skewY(-5deg) scaleX(0.93); } to { transform: skewY(4deg) scaleX(1); } }
@keyframes lore-rain { from { transform: translate(0, -160px); } to { transform: translate(-40px, 0); } }
@keyframes lore-snow { from { transform: translate(0, -300px); } to { transform: translate(36px, 0); } }
@keyframes lore-bolt { 0%, 78%, 100% { opacity: 0; } 79%, 83% { opacity: 1; } 81% { opacity: 0.15; } }
@keyframes lore-fire { 0%, 100% { opacity: 0.8; } 35% { opacity: 1; } 70% { opacity: 0.62; } }
@keyframes lore-drift { from { transform: translateX(-14px); } to { transform: translateX(14px); } }
@keyframes lore-rise { from { transform: translateY(0); opacity: 0.55; } to { transform: translateY(-60px); opacity: 0; } }
@keyframes lore-ring { 0% { box-shadow: 0 0 0 0 rgba(223, 193, 136, 0); } 25% { box-shadow: 0 0 0 2px rgba(223, 193, 136, 0.85), 0 0 30px rgba(223, 193, 136, 0.5); } 100% { box-shadow: 0 0 0 0 rgba(223, 193, 136, 0); } }
.la-tw { animation: lore-tw 3.4s ease-in-out infinite; }
.la-pulse { animation: lore-pulse 2.8s ease-in-out infinite; }
.la-flag { transform-box: fill-box; transform-origin: 0 50%; animation: lore-flag 1.7s ease-in-out infinite alternate; }
.la-rain { animation: lore-rain 0.5s linear infinite; }
.la-snow { animation: lore-snow 9s linear infinite; }
.la-bolt { animation: lore-bolt 7s linear infinite; }
.la-fire { animation: lore-fire 0.8s ease-in-out infinite; }
.la-drift { animation: lore-drift 16s ease-in-out infinite alternate; }
.la-rise { transform-box: fill-box; animation: lore-rise 5s linear infinite; }

/* the prologue: a book of five illustrated pages */
#lore-pro { position: fixed; inset: 0; z-index: 36; display: grid; place-items: center; padding: calc(16px + var(--safe-t)) 16px calc(16px + var(--safe-b)); background: radial-gradient(130% 100% at 50% 40%, rgba(20, 17, 13, 0.86), rgba(4, 5, 7, 0.97)); }
#lore-pro[hidden] { display: none; }
#lore-pro .book { position: relative; width: min(1100px, 100%); height: min(600px, 100%); display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(330px, 1fr); border-radius: 8px; overflow: hidden; background: #15171c; border: 1px solid var(--line-strong); box-shadow: 0 30px 90px rgba(0, 0, 0, 0.65), inset 0 1px 0 rgba(255, 255, 255, 0.05); }
#lore-pro .art { position: relative; min-height: 0; overflow: hidden; background: #08090b; touch-action: pan-y; }
#lore-pro .art svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; animation: lore-art 0.7s ease both; }
#lore-pro .art::after { content: ''; position: absolute; inset: 0; pointer-events: none; box-shadow: inset 0 0 70px rgba(0, 0, 0, 0.55), inset -1px 0 0 var(--line); }
#lore-pro .leaf { display: flex; flex-direction: column; min-height: 0; padding: 22px 26px 18px; gap: 8px; background: linear-gradient(180deg, rgba(223, 193, 136, 0.05), transparent 45%); }
#lore-pro .head { display: flex; align-items: center; gap: 12px; animation: lore-in 0.45s ease both; }
#lore-pro .kicker { flex: 1; font: 500 12.5px/1.2 var(--caps); letter-spacing: 0.18em; text-transform: uppercase; color: var(--bronze-hi); }
#lore-pro .skip { border: 0; background: none; padding: 6px 2px; cursor: pointer; color: var(--ink-faint); font: 500 13px var(--caps); letter-spacing: 0.08em; }
#lore-pro .skip:hover, #lore-pro .skip:focus-visible { color: var(--ink); }
#lore-pro h2 { margin: 2px 0 6px; font: 400 clamp(30px, 3.3vw, 42px)/1.04 var(--display); color: #fbf1dc; animation: lore-in 0.5s ease 0.05s both; }
#lore-pro .text { flex: 1; min-height: 0; overflow-y: auto; padding-right: 6px; font-size: 16px; line-height: 1.58; color: rgba(239, 230, 211, 0.84); animation: lore-in 0.55s ease 0.1s both; }
#lore-pro .text p { margin: 0 0 0.8em; }
#lore-pro .text p:first-child::first-letter { float: left; font: 400 3.1em/0.82 var(--display); margin: 0.06em 0.1em 0 0; color: var(--bronze-hi); }
#lore-pro .text b { color: var(--ink); font-weight: 700; }
#lore-pro .text.more { -webkit-mask-image: linear-gradient(#000 calc(100% - 40px), transparent); mask-image: linear-gradient(#000 calc(100% - 40px), transparent); }
@media (max-height: 680px) and (min-width: 761px) { #lore-pro .text { font-size: 15px; line-height: 1.5; } #lore-pro h2 { font-size: 34px; } #lore-pro .leaf { padding-top: 18px; } }
#lore-pro .foot { display: flex; align-items: center; gap: 8px; padding-top: 12px; border-top: 1px solid var(--line); }
#lore-pro .dots { flex: 1; display: flex; gap: 8px; align-items: center; }
#lore-pro .dots button { width: 10px; height: 10px; padding: 0; border-radius: 5px; border: 1px solid var(--bronze); background: transparent; cursor: pointer; transition: width 0.25s ease; }
#lore-pro .dots button[aria-current="true"] { width: 24px; background: var(--bronze-hi); border-color: var(--bronze-hi); }
#lore-pro .dots button { position: relative; }
#lore-pro .dots button::after { content: ''; position: absolute; inset: -12px -4px; }
#lore-pro .foot .btn { min-width: 88px; }
@media (max-width: 760px) {
  #lore-pro { padding: calc(8px + var(--safe-t)) 8px calc(8px + var(--safe-b)); }
  #lore-pro .book { height: 100%; grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
  #lore-pro .art { aspect-ratio: 4 / 3; max-height: 36vh; }
  #lore-pro .art::after { box-shadow: inset 0 0 50px rgba(0, 0, 0, 0.5), inset 0 -1px 0 var(--line); }
  #lore-pro .leaf { padding: 14px 16px 12px; gap: 6px; }
  #lore-pro h2 { font-size: 29px; margin-bottom: 4px; }
  #lore-pro .text { font-size: 15px; line-height: 1.52; }
  #lore-pro .foot { padding-top: 10px; }
  #lore-pro .foot .btn { min-width: 0; padding: 10px 14px; }
}

/* your path: the next step, under the player frame */
#lore-path { position: absolute; left: var(--pad); top: calc(var(--pad) + var(--safe-t) + 150px); width: 262px; padding: 8px 10px 10px; display: grid; gap: 6px; }
#lore-path .ph { display: flex; align-items: center; gap: 8px; min-width: 0; }
#lore-path .lbl { flex: 1; font: 500 11.5px/1 var(--caps); letter-spacing: 0.16em; text-transform: uppercase; color: var(--bronze-hi); white-space: nowrap; }
#lore-path .n { font: 700 11.5px/1 var(--ui); color: var(--ink-dim); font-variant-numeric: tabular-nums; white-space: nowrap; }
#lore-path .tog { flex: none; width: 24px; height: 22px; display: grid; place-items: center; padding: 0; border-radius: 4px; border: 1px solid var(--line); background: rgba(0, 0, 0, 0.28); color: var(--ink-dim); cursor: pointer; }
#lore-path .tog:hover { color: var(--ink); border-color: var(--line-strong); }
#lore-path .tog svg { width: 12px; height: 12px; }
#lore-path .step { display: grid; grid-template-columns: 12px minmax(0, 1fr); column-gap: 8px; row-gap: 4px; align-items: start; width: 100%; padding: 0; border: 0; background: none; text-align: left; cursor: pointer; color: var(--ink); font: inherit; }
#lore-path .gem { width: 8px; height: 8px; margin: 5px 0 0 2px; transform: rotate(45deg); background: var(--bronze-hi); box-shadow: 0 0 8px rgba(223, 193, 136, 0.8); flex: none; }
#lore-path .st { font-weight: 700; font-size: 14.5px; line-height: 1.25; }
#lore-path .step:hover .st { color: #fff4dc; }
#lore-path .hint { grid-column: 2; font-size: 12.5px; line-height: 1.35; color: var(--ink-dim); }
#lore-path .meter { grid-column: 2; display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: var(--ink-dim); font-variant-numeric: tabular-nums; white-space: nowrap; }
#lore-path .meter i { flex: 1; height: 5px; border-radius: 3px; background: rgba(0, 0, 0, 0.5); overflow: hidden; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.4); }
#lore-path .meter i b { display: block; height: 100%; background: linear-gradient(90deg, var(--bronze), var(--bronze-hi)); }
#lore-path .rw { grid-column: 2; display: flex; align-items: center; gap: 6px; font-size: 12px; color: #e3c56c; }
#lore-path .rw svg { width: 14px; height: 14px; flex: none; }
#lore-path.min { width: auto; max-width: 262px; padding: 6px 7px 6px 10px; }
#lore-path.min .st { flex: 1; min-width: 0; padding: 0; border: 0; background: none; color: var(--ink); font: 700 13px/1.2 var(--ui); text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
#lore-path.min .gem { margin: 0 2px 0 1px; }
#lore-path.ring { animation: lore-ring 1.6s ease; }
#lore-path .fin { grid-column: 1 / -1; font: 400 17px/1.25 var(--display); color: #fbf1dc; }
@media (max-width: 760px), (pointer: coarse) {
  #lore-path { width: 196px; padding: 7px 8px 8px; gap: 5px; }
  #lore-path.min { max-width: 196px; padding: 5px 6px 5px 9px; }
  body.touch #lore-path .tog { width: 32px; height: 28px; }
  #lore-path .st { font-size: 13.5px; }
  #lore-path .hint { font-size: 12px; }
  #tf:not([hidden]) ~ #lore-path { display: none; }
  #lore-path.min { transition: opacity 0.4s ease; }
  #zonetoast.on ~ #lore-path.min { opacity: 0.12; pointer-events: none; }
}

/* field notes and finished steps, in the banner lane; messages read above the nameplates */
#hud #banners { z-index: 3; }
#hud #lore-path { z-index: 2; }
#banners .lore-note { display: grid; gap: 3px; justify-items: start; text-align: left; width: min(480px, 92vw); padding: 10px 15px 12px; border-left-color: var(--bronze-hi); pointer-events: auto; cursor: pointer; animation: bannerin 0.4s ease, bannerout 0.6s ease 10.4s forwards; }
#banners .lore-note small, #banners .lore-step small { font: 500 11px/1.2 var(--caps); letter-spacing: 0.16em; text-transform: uppercase; color: var(--bronze-hi); }
#banners .lore-note b { font: 400 21px/1.15 var(--display); color: #fbf1dc; }
#banners .lore-note span { font-size: 14px; line-height: 1.42; color: rgba(239, 230, 211, 0.86); }
#banners .lore-step { display: grid; gap: 2px; border-left-color: #ffd36a; box-shadow: 0 0 30px rgba(255, 211, 106, 0.16), 0 6px 22px rgba(0, 0, 0, 0.35); }
#banners .lore-step b { font: 400 22px/1.15 var(--display); color: #fbf1dc; }
#banners .lore-step span { display: inline-flex; align-items: center; justify-content: center; gap: 6px; font-size: 14px; color: #f3d27a; }
#banners .lore-step span svg { width: 16px; height: 16px; }
@media (max-width: 760px), (pointer: coarse) {
  #banners .lore-note { padding: 8px 12px 10px; }
  #banners .lore-note b { font-size: 18px; }
  #banners .lore-note span { font-size: 13px; }
}

/* the death sheet and the loading screen */
#death .lore-dnote { margin: 0; max-width: 36ch; font-size: 14px; line-height: 1.45; color: var(--ink-dim); padding-top: 10px; border-top: 1px solid var(--line); }
#death .lore-dnote b { display: block; margin-bottom: 3px; font: 500 11px/1.3 var(--caps); letter-spacing: 0.16em; text-transform: uppercase; color: var(--bronze-hi); }
#loading .lore-ltip { width: min(440px, 84vw); min-height: 4.6em; margin-top: 10px; text-align: center; font: 400 14px/1.5 var(--ui); color: var(--ink-faint); transition: opacity 0.45s ease; }
#loading .lore-ltip b { display: block; margin-bottom: 5px; font: 500 11px/1 var(--caps); letter-spacing: 0.18em; text-transform: uppercase; color: var(--bronze); }

/* the Chronicle tab of the menu */
#menu .sheet:has(.chron) { width: min(840px, 100%); }
.chron { display: grid; gap: 14px; }
.chron-nav { position: sticky; top: -20px; z-index: 3; display: grid; gap: 7px; margin: -4px -22px 0; padding: 6px 22px 10px; background: #1a1c21; border-bottom: 1px solid var(--line); }
.chron-grps, .chron-secs { display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; }
.chron-grps { gap: 2px 14px; border-bottom: 1px solid var(--line); }
.chron-nav button { flex: none; border: 1px solid var(--line); background: rgba(255, 255, 255, 0.03); color: var(--ink-dim); border-radius: 999px; padding: 5px 11px; font: 500 13.5px var(--ui); cursor: pointer; white-space: nowrap; }
.chron-nav button:hover { color: var(--ink); border-color: var(--line-strong); }
.chron-nav button[aria-current="true"] { background: var(--bronze-hi); border-color: var(--bronze-hi); color: #1b140b; }
.chron-nav button[hidden] { display: none; }
.chron-grps button { border: 0; border-bottom: 2px solid transparent; border-radius: 0; background: none; padding: 6px 2px 5px; margin-bottom: -1px; font: 500 12px/1.2 var(--caps); letter-spacing: 0.14em; text-transform: uppercase; color: var(--ink-faint); }
.chron-grps button:hover { color: var(--ink); }
.chron-grps button[aria-current="true"] { background: none; color: var(--bronze-hi); border-bottom-color: var(--bronze-hi); }
.chron-body { display: grid; gap: 12px; animation: lore-in 0.35s ease both; }
.chron-body > p, .chron .card p { margin: 0; line-height: 1.55; }
.chron-body p b, .chron .card p b { color: var(--ink); font-weight: 700; }
.chron .lead { font-size: 16.5px; line-height: 1.6; color: rgba(239, 230, 211, 0.9); }
.chron .lead::first-letter { float: left; font: 400 3em/0.8 var(--display); margin: 0.06em 0.09em 0 0; color: var(--bronze-hi); }
.chron h3 { margin: 6px 0 -2px; }
.chron .now { font-size: 13.5px; color: var(--ink-faint); }
.chron .now b { color: var(--ink-dim); }
.chron .card { padding: 12px 14px; border-radius: 6px; background: rgba(0, 0, 0, 0.24); border: 1px solid var(--line); display: grid; gap: 8px; }
.chron .rcard { border-left: 3px solid var(--rc); }
.chron .rhead { display: flex; align-items: center; gap: 10px; }
.chron .rhead .em { color: var(--rc); display: grid; }
.chron .rhead b { font: 400 26px/1 var(--display); color: #fbf1dc; }
.chron .rhead i { font-style: normal; color: var(--ink-faint); font-size: 13px; }
.chron .rhead small { margin-left: auto; padding: 3px 8px; border-radius: 999px; border: 1px solid var(--rc); font: 500 11px/1.2 var(--caps); letter-spacing: 0.1em; color: var(--ink); text-transform: uppercase; white-space: nowrap; }
.chron .facts { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 4px 12px; margin: 0; font-size: 13.5px; }
.chron .facts dt { color: var(--bronze-hi); font: 500 11.5px/1.75 var(--caps); letter-spacing: 0.08em; text-transform: uppercase; }
.chron .facts dd { margin: 0; color: var(--ink); line-height: 1.45; }
.chron .facts dd span { color: var(--ink-dim); }
.chron .grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.chron .order { display: grid; gap: 5px; align-content: start; padding: 10px 12px; border-radius: 6px; background: rgba(0, 0, 0, 0.24); border: 1px solid var(--line); }
.chron .order b { display: flex; align-items: center; gap: 8px; font-size: 15.5px; color: var(--ink); }
.chron .order b svg { color: var(--bronze-hi); flex: none; }
.chron .order em { font-style: normal; font: 500 11.5px/1.3 var(--caps); letter-spacing: 0.08em; color: var(--bronze-hi); text-transform: uppercase; }
.chron .order p { margin: 0; font-size: 13.5px; line-height: 1.5; color: var(--ink-dim); }
.chron .live { display: grid; gap: 5px; font-size: 13.5px; }
.chron .live div { display: flex; align-items: center; gap: 9px; padding: 7px 10px; border-radius: 5px; background: rgba(0, 0, 0, 0.24); min-width: 0; }
.chron .live svg { color: var(--bronze-hi); flex: none; }
.chron .live span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chron .live em { margin-left: auto; font-style: normal; color: var(--ink-dim); white-space: nowrap; }
.chron .tide { display: grid; grid-template-columns: minmax(0, 1.3fr) auto auto minmax(0, 1.4fr); gap: 7px 14px; align-items: center; font-size: 13.5px; padding: 10px 12px; border-radius: 6px; background: rgba(0, 0, 0, 0.24); border: 1px solid var(--line); }
.chron .tide .h { font: 500 11px/1.2 var(--caps); letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-faint); }
.chron .tide .r { display: flex; align-items: center; gap: 8px; font-weight: 700; }
.chron .tide .r i { width: 10px; height: 10px; border-radius: 2px; background: var(--rc); flex: none; }
.chron .tide .c { text-align: center; font-variant-numeric: tabular-nums; }
.chron .tide .w { color: var(--ink-dim); font-size: 12.5px; }
.chron .figure { margin: 0; border-radius: 8px; overflow: hidden; border: 1px solid var(--line); background: #0e1014; }
.chron .figure svg { display: block; width: 100%; height: auto; }
.chron .figure.map { width: min(100%, 470px); justify-self: center; }
.chron .legend { display: flex; flex-wrap: wrap; gap: 6px 16px; padding: 9px 12px; font-size: 12.5px; color: var(--ink-dim); border-top: 1px solid var(--line); }
.chron .legend span { display: inline-flex; align-items: center; gap: 6px; }
.chron .legend svg { width: 14px; height: 14px; flex: none; }
.chron .dg-tall { display: none; }
.chron .num { font-variant-numeric: tabular-nums; }
.chron ol.how { margin: 0; padding: 0; list-style: none; display: grid; gap: 8px; counter-reset: how; }
.chron ol.how li { position: relative; padding: 0 0 0 34px; line-height: 1.5; color: var(--ink-dim); counter-increment: how; }
.chron ol.how li::before { content: counter(how); position: absolute; left: 0; top: 1px; width: 23px; height: 23px; border-radius: 50%; display: grid; place-items: center; border: 1px solid var(--line-strong); color: var(--bronze-hi); font: 700 12px/1 var(--ui); }
.chron ol.how b, .chron ul.plain b { color: var(--ink); }
.chron ul.plain { margin: 0; padding: 0; list-style: none; display: grid; gap: 5px; }
.chron ul.plain li { line-height: 1.45; color: var(--ink-dim); font-size: 14px; }
.chron ul.champs { margin: 0; padding: 0; list-style: none; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 12px; font-size: 13.5px; }
.chron ul.champs li { display: flex; justify-content: space-between; gap: 8px; min-width: 0; }
.chron ul.champs b { color: var(--ink); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chron ul.champs b.gone { color: var(--ink-faint); font-style: italic; }
.chron ul.champs small { color: var(--ink-faint); white-space: nowrap; font-size: 12.5px; }
.chron .cons { display: flex; flex-wrap: wrap; gap: 6px; }
.chron .cons span { display: inline-flex; align-items: center; gap: 7px; padding: 4px 10px; border-radius: 999px; background: rgba(0, 0, 0, 0.3); font-size: 12.5px; color: var(--ink-dim); }
.chron .cons i { width: 9px; height: 9px; border-radius: 50%; background: var(--c); box-shadow: 0 0 6px var(--c); }
.chron .steps { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; }
.chron .steps li { display: grid; grid-template-columns: 24px minmax(0, 1fr) auto; gap: 4px 11px; align-items: center; padding: 8px 11px; border-radius: 6px; background: rgba(0, 0, 0, 0.24); border: 1px solid transparent; }
.chron .steps li.cur { border-color: var(--line-strong); background: rgba(223, 193, 136, 0.09); }
.chron .steps li.done b { color: var(--ink-dim); }
.chron .steps .mk { width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; border: 1px solid var(--line-strong); color: var(--bronze-hi); font: 700 11.5px/1 var(--ui); }
.chron .steps li.done .mk { background: var(--bronze-hi); border-color: var(--bronze-hi); color: #1b140b; }
.chron .steps li.cur .mk { box-shadow: 0 0 10px rgba(223, 193, 136, 0.6); }
.chron .steps b { display: block; font-size: 14.5px; color: var(--ink); }
.chron .steps small { display: block; color: var(--ink-dim); font-size: 12.5px; line-height: 1.35; }
.chron .steps .rw { display: inline-flex; align-items: center; gap: 5px; color: #e3c56c; font-size: 12.5px; white-space: nowrap; }
.chron .steps .rw svg { width: 14px; height: 14px; }
.chron .steps li.done .rw { color: var(--ink-faint); }
.chron .note { border-left: 3px solid var(--bronze); padding: 8px 12px; background: rgba(223, 193, 136, 0.06); border-radius: 0 6px 6px 0; font-size: 13.5px; line-height: 1.5; color: var(--ink-dim); }
.chron .note b { display: block; font: 400 17px/1.25 var(--display); color: #fbf1dc; margin-bottom: 2px; }
.chron .acts { display: flex; gap: 8px; flex-wrap: wrap; }
@media (max-width: 640px) {
  .chron .dg-wide { display: none; }
  .chron .dg-tall { display: block; }
  .chron .grid2, .chron ul.champs { grid-template-columns: minmax(0, 1fr); }
  .chron-grps, .chron-secs { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; }
  .chron-grps::-webkit-scrollbar, .chron-secs::-webkit-scrollbar { display: none; }
  .chron .tide { grid-template-columns: minmax(0, 1fr) auto auto; gap: 6px 10px; font-size: 13px; }
  .chron .tide .w { grid-column: 1 / -1; margin-top: -4px; padding-left: 18px; }
  .chron .tide .h.w { display: none; }
  .chron .steps li { grid-template-columns: 24px minmax(0, 1fr); }
  .chron .steps .rw { grid-column: 2; }
}
@media (max-width: 520px) {
  #menu-tabs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border-radius: 14px; }
  #menu-tabs button { padding: 7px 6px; }
}
@media (prefers-reduced-motion: reduce) {
  .la-tw, .la-pulse, .la-flag, .la-rain, .la-snow, .la-bolt, .la-fire, .la-drift, .la-rise, #lore-pro .art svg, #lore-pro .head, #lore-pro h2, #lore-pro .text, .chron-body, #lore-path.ring { animation: none !important; }
}
`;
(function loreStyle() {
  const st = document.createElement('style');
  st.id = 'lore-css';
  st.textContent = LORE_CSS;
  (document.body || document.documentElement).appendChild(st);
})();

/* ------------------------------------------------------------------ */
/* state and small helpers                                             */
/* ------------------------------------------------------------------ */
const LORE = {
  pro: null, chronSec: 'march', begin: -1e9,
  watchT: 0, hudT: 0, placeT: 0, hudKey: '', top: -1, min: null,
  ev: {}, bounty: null, potions: 0, carried: null, doors: new Map(), elites: new Set(), loot: new Set(),
  queue: [], noteUntil: 0, deathShown: false,
};
const loreAn = (w) => (/^[aeiou]/i.test(w) ? 'an' : 'a');
const homeIn = (R) => R.homeName.replace(/^The /, 'the ');
// how to do things, in the words of the device in hand
function LK() {
  return IS_TOUCH
    ? { use: 'tap Use', potion: 'tap Potion', map: 'tap the map button', kit: 'tap Kit', ride: 'tap Ride', menu: 'tap the menu button' }
    : { use: 'press E', potion: 'press Q', map: 'press M', kit: 'press I', ride: 'press R', menu: 'press Esc' };
}
Object.assign(ICONS, {
  lhallow: '<circle cx="12" cy="10.5" r="4"/><path d="M12 2.6v1.6M12 16.8v1.6M4.1 10.5h1.6M18.3 10.5h1.6M6.4 4.9l1.1 1.1M16.5 15l1.1 1.1M17.6 4.9L16.5 6M7.5 15l-1.1 1.1M7 21.4h10"/>',
  lgate: '<path d="M4 21V11a8 8 0 0 1 16 0v10"/><path d="M8.2 21v-9.6M12 21V8.6M15.8 21v-9.6M5.6 14.4h12.8M5.6 18h12.8"/>',
  ltemple: '<path d="M2.8 9.6L12 4l9.2 5.6"/><path d="M3.6 9.6h16.8M5.6 10v9M9.2 10v9M14.8 10v9M18.4 10v9M2.8 21h18.4"/>',
  lkeep: '<path d="M4.5 21V10.5h3V8h2v2.5h5V8h2v2.5h3V21"/><path d="M10 21v-3.6a2 2 0 0 1 4 0V21"/><path d="M12 8V2.8l4.2 1.6L12 6"/>',
  lup: '<path d="M5 19L15 9M15 9h-4.5M15 9v4.5"/><path d="M3 21l2-2M19 3v6M16 6l3-3 3 3"/>',
  lpatrol: '<circle cx="12" cy="12" r="8.4"/><path d="M12 6.4v5.6l3.6 2.4"/><path d="M12 1.6v1.8M12 20.6v1.8"/>',
  lretrieve: '<circle cx="15.5" cy="8.5" r="3.4"/><path d="M3 20c2.5-5 6-7 10-7.4M9 9.4L3 12l2.6 6"/>',
  lcarry: '<circle cx="12" cy="4.6" r="2.2"/><path d="M12 8v6.4M8.4 21l3.6-6.6 3.6 6.6M7.6 11.2L12 9.4l4.4 1.8"/>',
  lpath: '<path d="M5 21c0-5 6-4.6 6-9s-5-3.6-5-7.4C6 3 7.4 2 9 2"/><circle cx="17.5" cy="4.6" r="1.6"/><circle cx="15.6" cy="12" r="1.6"/><circle cx="18" cy="19.4" r="1.6"/>',
  lplus: '<path d="M12 5v14M5 12h14"/>',
  lminus: '<path d="M5 12h14"/>',
});
const fx1 = (v) => String(Math.round(v * 10) / 10);
function laShade(hex, k) { return '#' + hex3(hex).map((v) => Math.round(clamp(v * k, 0, 1) * 255).toString(16).padStart(2, '0')).join(''); }

/* ------------------------------------------------------------------ */
/* your path: from recruit to the height of your powers ([guide] 24)   */
/* ------------------------------------------------------------------ */
// lv: when the step usually comes; level: reached by levelling; old: a character from before
// the path who is already this strong is taken to have done it (no reward)
const PATH_STEPS = [
  { id: 'herald', lv: 1, old: 5, title: 'Speak with the herald', short: 'The herald',
    hint: (R) => `The ${R.name} Herald stands in the square of ${R.townName}, by the portal stones. Walk up to him and ${LK().use}.`,
    reward: { potions: 2 } },
  { id: 'bounty', lv: 1, old: 8, title: 'Finish a bounty', short: 'A bounty',
    hint: (R, prog) => prog.bounty ? (prog.bounty.done ? `Done. Go back to the ${R.name} Herald for your pay.` : `Slay ${prog.bounty.need} ${pluralName(prog.bounty.name)} at the place circled on your map (${LK().map}), then go back to the herald.`) : `Take a bounty from the ${R.name} Herald in ${R.townName}, slay the creatures he names, then return to him.`,
    meter: (prog) => (prog.bounty && !prog.bounty.done ? [prog.bounty.have / prog.bounty.need, `${prog.bounty.have} / ${prog.bounty.need} slain`] : null),
    reward: { item: { slot: 'weapon', q: 2 } } },
  { id: 'lv5', lv: 5, level: 5, title: 'Reach level 5', short: 'Level 5',
    hint: (R) => `Hunt the creatures of ${homeIn(R)}. A name in green or blue is an easy kill; orange and red will hurt.`,
    reward: { gold: () => 40 } },
  { id: 'draught', lv: 5, old: 8, title: 'Buy a healing draught', short: 'A draught',
    hint: (R) => `${R.merchant ? R.merchant.name : 'The merchant'} keeps a stall in ${R.townName}: ${LK().use} beside it to trade. In a fight, ${LK().potion} to drink one.`,
    reward: { xp: 0.25 } },
  // [guide] the living side of the March, between the first bounty and the frontier (pv 2: added in version 13)
  { id: 'cook', lv: 5, old: 5, pv: 2, title: 'Cook a meal', short: 'Cook a meal',
    hint: () => (goodsHave('meat_raw') || goodsHave('fish_raw') ? `${LK().use} at any fire (a hearth, a brazier, a campfire) to cook your raw meat and fish. Cooked food fills you four times as well.` : 'Hunt a wolf, a boar or a deer for its meat (or catch a fish), then cook it at any fire: a hearth, a brazier, a campfire.'),
    reward: { potions: 1 } },
  { id: 'craft', lv: 8, old: 10, pv: 2, title: 'Make something at a workstation', short: 'Make something',
    hint: (R) => `${R.townName} has a forge, a workbench, a tanning rack, a loom, a bakehouse and an alchemy table: ${LK().use} at one for its recipes. Tan a hide into leather, or steep two woundwort with water into a healing draught.`,
    reward: { gold: (L) => 30 + L * 4 } },
  { id: 'muster', lv: 14, old: 18, title: 'Go to the muster', short: 'The muster',
    hint: (R, prog) => `${prog.level < 14 ? 'Once you reach level 14, step' : 'Step'} through the portal stones in ${R.townName} to ${R.name} Muster on the frontier.`,
    meter: (prog) => (prog.level < 14 ? [loreLvlFrac(prog, 14), `Level ${prog.level} of 14`] : null),
    reward: { item: { slot: 'cloak', q: 3 } } },
  { id: 'climb', lv: 14, old: 18, pv: 2, title: 'Climb a tower of your keep', short: 'Climb a tower',
    hint: () => `Go in at the courtyard door of a tower of one of your realm's keeps and climb to its top: walk into a ladder (or ${LK().use}), and the hatch above opens as you come up to it.`,
    reward: { xp: 0.25 } },
  { id: 'warband', lv: 14, old: 20, title: "Join a warband's fight", short: 'A warband fight',
    hint: (R) => `Warbands of ${R.name} march out from the muster. Follow one to its fight (your realm's markers on the map) and fight beside it.`,
    reward: { xp: 1 / 3 } },
  { id: 'gate', lv: 15, old: 22, title: 'Help break a keep gate', short: 'A keep gate',
    hint: () => 'Target an enemy keep\'s gate and strike it while a warband lays siege. It takes many blows, and the archers on the walls shoot back.',
    reward: { gold: (L) => 40 + L * 6 } },
  { id: 'hallow', lv: 16, title: 'Carry a hallow home', short: 'A hallow home',
    hint: (R) => `Once an enemy realm has lost a keep, its temple gate can be broken. Take the hallow (${LK().use}) and carry it to the ${R.templeName}.`,
    reward: { item: { slot: 'weapon', q: 4 } } },
  { id: 'barrow', lv: 18, title: 'Enter the Hollow Barrow', short: 'The Barrow',
    hint: () => 'A long grassy mound just east of the Lone Tree, at the heart of the March, with a ring of standing stones before its door. Best at level 18 or so.',
    reward: { potions: 3 } },
  { id: 'king', lv: 18, title: 'Defeat the Hollow King', short: 'The Hollow King',
    hint: () => 'Fight down through the barrow, slay the warden of the Well of Souls to open its gate, and face the king on his throne.',
    reward: { gold: (L) => 120 + L * 8 } },
  { id: 'lv20', lv: 20, level: 20, title: 'Reach level 20', short: 'Level 20',
    hint: () => 'Level 20 brings your seventh ability. People and creatures grow through their own work and battles; the March\'s development opens new possibilities.',
    reward: { item: { slot: 'ring', q: 3 } } },
  { id: 'champion', lv: 20, title: 'Defeat a borderland champion', short: 'A champion',
    hint: (R) => `Out toward the wild edges of ${homeIn(R)}, named champions lead the borderland camps. They begin at level 1 and develop through their own experience.`,
    reward: { item: { slot: 'charm', q: 4 } } },
  // [guide] the late game's deeds (pv 2)
  { id: 'command', lv: 20, pv: 2, title: 'Command a warband', short: 'Command a band',
    hint: (R) => `Open the map (${LK().map}), choose one of ${R.name}'s warbands and give it a keep to take or defend, a temple to raid, or call it to rally to you. You may from level 20 or realm rank 3, or at the war table in a keep's great hall.`,
    reward: { gold: (L) => 50 + L * 5 } },
  { id: 'keep', lv: 22, pv: 2, title: 'Take an enemy keep', short: 'Take a keep',
    hint: () => 'Fight with a warband at an enemy keep: break its gate or storm a breach, slay the lord in the courtyard, and its banners turn to your colours.',
    reward: { item: { slot: 'head', q: 4 } } },
  { id: 'lv30', lv: 30, level: 30, title: 'Reach level 30', short: 'Level 30',
    hint: () => 'At 30 you learn your eighth ability, and every ability you know reaches rank II.',
    reward: { xp: 0.5 } },
  { id: 'gift', lv: 30, pv: 2, title: 'Call your realm\'s great gift', short: 'The great gift',
    hint: () => `At realm rank 5 or level 30 your realm's great gift opens: ${IS_TOUCH ? 'the round gift button over your abilities' : 'key 9'} calls it. Save it for a big fight.`,
    meter: (prog) => (prog.level < 30 && realmRank(prog.rp) < 5 ? [loreLvlFrac(prog, 30), `Level ${prog.level} of 30`] : null),
    reward: { xp: 0.25 } },
  { id: 'dragon', lv: 32, pv: 2, title: 'Bring down Cinderwing', short: 'Cinderwing',
    hint: () => 'The great red dragon rests on high ground between its flights: the gold gem marks it while it is in the sky. A fight for the strong, or for many.',
    reward: { item: { slot: 'legs', q: 4 } } },
  { id: 'lv40', lv: 40, level: 40, title: 'Reach level 40', short: 'Level 40',
    hint: () => 'Your abilities reach rank III at 40. Risen encounters become available as the March develops; each creature grows at its own pace.', // [late2] (10l_late.js)
    reward: { item: { slot: 'chest', q: 4 } } },
  { id: 'master', lv: 40, pv: 2, title: 'Make a named masterwork', short: 'A masterwork',
    hint: () => 'A master crafter (crafting 85 and up) of level 40 makes them at the forge, the workbench, the tanning rack or the loom, from dragon scales, grave-iron from the Barrow\'s dead and champions\' trophies.',
    reward: { gold: (L) => 200 + L * 10 } },
  { id: 'campaign', lv: 42, pv: 2, title: 'Win a campaign', short: 'Win a campaign',
    hint: (R) => `${R.name} wins by holding four of the six keeps for five minutes, or both enemy hallows for four. Lead its warbands and carry the hallows home.`,
    reward: { item: { slot: 'cloak', q: 5 } } },
  { id: 'lv50', lv: 50, level: 50, title: 'Reach level 50', short: 'Level 50',
    hint: () => 'The height of your powers: rank IV. Past 50 your own experience raises your veterancy.', // [late2] (10l_late.js)
    reward: { item: { slot: 'weapon', q: 5 } } },
];
const PATH_BY_ID = Object.fromEntries(PATH_STEPS.map((S, i) => { S.idx = i; return [S.id, S]; }));
const PATH_VERSION = 3; // [guide] 2: the steps of version 13 (pv 2 on a step); [loops] 3: supplying the realm and escorting a cart (08m_loops.js)
const REWARD_SLOT_WORD = { weapon: 'weapon', cloak: 'cloak', ring: 'ring', charm: 'charm', chest: 'chest piece', head: 'helm', hands: 'pair of gloves', legs: 'pair of leggings' };
function loreLvlFrac(prog, target) { return clamp((prog.level - 1 + (prog.level >= LEVEL_CAP ? 0 : prog.xp / xpToNext(prog.level))) / Math.max(1, target - 1), 0, 1); }
function pathDone(id) { const L = GAME.prog && GAME.prog.lore; return !!L && L.done.includes(id); }
function pathNext() { return PATH_STEPS.find((S) => !pathDone(S.id)) || null; }
// what a step will pay: gold at the level it is likely taken, experience as a share of a level
const XP_SHARE = [[0.25, 'a quarter'], [1 / 3, 'a third'], [0.5, 'half']];
function rewardLabel(S, prog, ahead = false) {
  const Rw = S.reward, L = ahead ? Math.max(prog.level, S.lv) : prog.level;
  if (Rw.gold || (Rw.xp && L >= LEVEL_CAP)) return { ic: 'coin', t: `${fmtInt(Rw.gold ? Rw.gold(L) : 15 * L)} gold` };
  if (Rw.xp) { const sh = XP_SHARE.find(([v]) => Math.abs(v - Rw.xp) < 0.01); return { ic: 'spark', t: `${sh ? sh[1] : fmtInt(Rw.xp * 100) + '%'} of a level in experience` }; }
  if (Rw.potions) return { ic: 'potion', t: `${Rw.potions} healing draught${Rw.potions === 1 ? '' : 's'}` }; // [guide] one draught
  const Q = QUALITY[Rw.item.q];
  return { ic: SLOT_ICON[Rw.item.slot] || 'sword', t: `${loreAn(Q.name)} ${Q.name.toLowerCase()} ${REWARD_SLOT_WORD[Rw.item.slot] || Rw.item.slot}`, col: Q.col };
}
// pay a step's reward and say what it was
function pathPay(S) {
  const P = GAME.player, prog = GAME.prog, Rw = S.reward, L = prog.level;
  if (Rw.gold || (Rw.xp && L >= LEVEL_CAP)) { const g = Rw.gold ? Rw.gold(L) : 15 * L; addGold(g); return { ic: 'coin', t: `${fmtInt(g)} gold` }; }
  if (Rw.xp) { const n = Math.round(xpToNext(L) * Rw.xp); addXP(n); return { ic: 'spark', t: `${fmtInt(n)} experience` }; }
  if (Rw.potions) {
    const n = clamp(POTION.max - INV.potions, 0, Rw.potions), spare = Rw.potions - n;
    INV.potions += n;
    LORE.potions = INV.potions;
    if (spare > 0) addGold(spare * potionPrice());
    sfx('potion');
    const draughts = `${n} healing draught${n === 1 ? '' : 's'}`;
    return { ic: 'potion', t: !spare ? draughts : n ? `${draughts} and ${fmtInt(spare * potionPrice())} gold` : `${fmtInt(spare * potionPrice())} gold, as your draughts are full` };
  }
  const it = makeItem({ cls: P.cls, realm: P.faction, lvl: clamp(L, 1, LEVEL_CAP), q: Rw.item.q, slot: Rw.item.slot }); // [balance2] at your level, to 50
  if (!bagAdd(it)) { dropItem(it, P.x, P.z, P.y + 1.2); uiLog('Your bags are full: your reward lies at your feet.', 'warn'); }
  else if (!INV.eq[it.slot] && !canEquip(it)) equipItem(it);
  if (UI.modal === 'kit') renderKit();
  sfx(it.q >= 4 ? 'lootEpic' : 'lootRare');
  return { ic: itemIcon(it), t: esc(it.name), col: QUALITY[it.q].col };
}
function pathComplete(S, silent = false) {
  const L = GAME.prog.lore;
  if (L.done.includes(S.id)) return;
  L.done.push(S.id);
  LORE.ev[S.id] = false;
  LORE.hudKey = '';
  if (silent) return;
  const got = pathPay(S);
  activityRecord('path.completed', S.id, 1, { success: true });
  const host = $('banners');
  const d = document.createElement('div');
  d.className = 'banner panel lore-step';
  d.innerHTML = `<small>Your path · ${L.done.length} of ${PATH_STEPS.length}</small><b>${S.title}</b><span${got.col ? ` style="color:${got.col}"` : ''}>${iconSvg(got.ic, 16)}${got.t}</span>`;
  host.appendChild(d);
  setTimeout(() => d.remove(), 6200);
  while (host.childNodes.length > 3) host.removeChild(host.firstChild);
  HUDL.k = 0; // [guide]
  uiLog(`Your path: ${S.title}. Reward: ${got.t.replace(/<[^>]*>/g, '')}.`, 'rp');
  sfx('fanfare');
  const el = $('lore-path');
  if (el) { el.classList.remove('ring'); void el.offsetWidth; el.classList.add('ring'); }
  saveSoon(800);
}

/* ------------------------------------------------------------------ */
/* field notes: first-time context, once per character                 */
/* ------------------------------------------------------------------ */
const FIELD_NOTES = {
  start: { t: 'First steps', x: () => (IS_TOUCH ? `Drag on the ${MOBILE_PREFS.hand === 'left' ? 'right' : 'left'} of the screen to walk and on the ${MOBILE_PREFS.hand === 'left' ? 'left' : 'right'} to look around. Tap a creature to target it, then tap an ability. Your path, at the top left, shows your next step; the gold gem on the minimap marks where.` : 'WASD to walk, drag to look. Click a creature, then press 1. Your path, at the left of the screen, shows your next step; the gold gem on the minimap marks where. H shows every key.') }, // [guide] the gem
  news: { t: 'New: the Chronicle', x: () => `The story of the March, how the war is won and what the commanders' orders mean are now in the Chronicle (${LK().menu}). Your path, at the left, shows your next step.` },
  frontier: { t: 'The frontier', x: (R) => `Here the three realms fight. Friendly names show in blue. Warbands of ${R.name} march out from the muster, and its portal stones take you home.` },
  keep: { t: 'An enemy keep', x: () => 'Its gates shut against you. Break the gate (or storm a breach), then slay the lord inside and the keep is your realm\'s. Archers on the walls and towers shoot at anyone close, so come with a warband.' }, // [guide] gates shut, breaches
  mount: { t: 'On horseback', x: () => `Your horse carries you nearly twice as fast. Any blow throws you from the saddle, and you cannot call it in the heat of battle or while you carry a hallow. ${capFirst(LK().ride)} to step down.` },
  loot: { t: 'Loot', x: () => `Foes drop gear in six grades, from worn grey to legendary orange; the brighter the beam, the better the find, and of about the foe's own level, all the way to 50: champions, Cinderwing and the Hollow King's hoard a little above. ${capFirst(LK().kit)} to look it over and put it on, and sell what you do not need to a merchant.` }, // [balance2]
  barrow: { t: 'The Hollow Barrow', x: () => 'The dead here wake together, so take one pack at a time. The Burning Gallery breathes fire in bursts: cross between them. The gate of the Well of Souls opens only when its warden falls. The stair by the mouth leads back up.' },
  rain: { t: 'Rain', x: () => 'Rain sweeps across the March and soaks the land, and storms bring thunder and lightning. The weather turns every few minutes.' },
  snow: { t: 'Snow', x: () => 'In Thule and up on the passes the rain falls as snow. It settles on the ground and the roofs, and melts when the weather turns.' },
  dragon: { t: 'Cinderwing', x: () => 'The great red dragon. It lands on high ground to fight: keep out of the line of its fire and away from its tail, and do not take it on alone unless you are far stronger.' },
  lowhp: { t: 'Badly hurt', x: () => `${capFirst(LK().potion)} to drink a healing draught and win back 40% of your health. Out of a fight you heal on your own.` },
  carry: { t: 'Hallow-bearer', x: (R) => `You carry a hallow. You walk slowly and cannot ride or fight, and every enemy wants you dead. Get it to the ${R.templeName} with your warband around you.` },
  command: { t: 'Command', x: (R) => `You may now command the warbands of ${R.name}. Open the map (${LK().map}), choose a band, and give it a keep or temple to take, or tell it to rally to you.` },
  claim: { t: 'A claim on the March', x: () => 'A realm holds four keeps, or both enemy hallows. If it keeps them long enough it wins the campaign: watch the countdown under the minimap, and break the hold if it is not yours.' },
  campaign: { t: 'The campaign is over', x: () => 'After a short peace every keep and hallow goes back to its own realm and a new campaign begins. The Chronicle keeps the record of each.' },
  death: { t: 'Death', x: (R) => `You lose nothing but the walk back: your gear, gold and experience stay with you. Release to rise again at ${R.name} Muster if you fell on the frontier, or in ${R.townName} at home.` },
};
const LOADING_TIPS = [
  'A name\'s colour shows how a foe measures up to you: grey is beneath you, yellow is your equal, red will kill you.',
  'The portal stones in your town carry you to your realm\'s muster on the frontier, and back.',
  'A temple\'s gate cannot be harmed while its realm still holds both of its keeps.',
  'Every foreign hallow set in your temple makes each soldier of your realm strike a tenth harder.',
  'A dropped hallow goes back by itself to the temple it was taken from after a minute and a half.',
  'A hallow-bearer walks slowly and cannot ride. Keep your warband close around them.',
  'Whistle for your horse to ride nearly twice as fast. A single blow throws you from the saddle.',
  'Merchants buy what you do not need. Sell grey gear and trophies for coin.',
  'A healing draught gives back 40% of your health. It takes thirty seconds before you can drink another.',
  'A keep rebuilds a broken gate once it has been quiet for forty seconds. Take the lord before they mend it.',
  'People and creatures begin at level 1 and grow through their own work and battles. The March\'s development opens new possibilities.',
  'Every ten levels past 20 your abilities grow a rank stronger.',
  'Rain falls as snow in Thule and up on the high passes.',
  'The Hollow King\'s vault holds the best loot in the land.',
  'The warden of the Well of Souls holds the key to the Hollow King\'s gate.',
  'A realm down to its last keep musters bigger warbands, and faster.',
  'Named champions lead the borderland camps. Their strength comes from their own experience.',
  'Realm points come from enemy soldiers, keeps and hallows. Each realm rank adds to your health and damage.',
  'Commanders send their warbands at near, weak keeps, and above all at keeps their own realm has lost. Every order is drawn on your map.',
  'A realm wins the campaign by holding four of the six keeps for five minutes, or both enemy hallows for four.',
  'From realm rank 3 or level 20 you can command your realm\'s warbands from the map.',
  'After an hour of war the elders give the March to the realm with the most renown.',
  'Your path, at the left of the screen, always shows your next step, and every step pays a reward.',
  'Out of a fight, you heal on your own. In one, a healing draught is quicker.',
  'Cinderwing rests on high ground. Keep out of the line of its fire and away from its tail.',
];

/* ------------------------------------------------------------------ */
/* the art: five scenes of the March, drawn in code as SVG              */
/* ------------------------------------------------------------------ */
// every scene is 800 x 600 and is cropped to fit its frame, so what matters is kept in the middle
function laP(pts) { return pts.map((p) => fx1(p[0]) + ',' + fx1(p[1])).join('L'); }
function laArea(pts, bottom = 620) { return `M${fx1(pts[0][0])},${bottom}L${laP(pts)}L${fx1(pts[pts.length - 1][0])},${bottom}Z`; }
// a skyline across the frame: fbm hills or ridged peaks, with optional passes cut into it
function laRidge(o) {
  const pts = [];
  for (let x = o.x0 ?? -20; x <= (o.x1 ?? 820); x += o.step || 5) {
    const n = o.sharp ? ridged(x * o.freq + o.seed, o.seed * 0.37, 4) : fbm(x * o.freq + o.seed, o.seed * 0.37, 4);
    let y = o.y - o.amp * n;
    if (o.notch) for (const [nx, nw, ny] of o.notch) y = lerp(y, ny, Math.exp(-(((x - nx) / nw) ** 2)));
    pts.push([x, y]);
  }
  return pts;
}
// the snow on a ridge: a band hanging from the crest wherever it rises above the snow line
function laSnowcap(pts, line, depth, seed) {
  const top = [], bot = [];
  for (const [x, y] of pts) {
    const jag = depth * (0.55 + 0.9 * vnoise(x * 0.07, seed));
    top.push([x, y]);
    bot.push([x, Math.max(y, Math.min(y + jag, line + jag * 0.4))]);
  }
  return `M${laP(top)}L${laP(bot.reverse())}Z`;
}
function laStars(r, n, yMax, op = 1) {
  let s = '';
  for (let i = 0; i < n; i++) {
    const x = r() * 800, y = r() * yMax * (0.35 + 0.65 * r()), big = r() < 0.12;
    const tw = r() < 0.3;
    s += `<circle cx="${fx1(x)}" cy="${fx1(y)}" r="${big ? 1.6 : 0.6 + r() * 0.7}" fill="#fff4e0" opacity="${fx1((0.25 + r() * 0.6) * op)}"${tw ? ` class="la-tw" style="animation-delay:${fx1(-r() * 3.4)}s"` : ''}/>`;
  }
  return s;
}
// a broad tree, grown by splitting branches; leaves gather in clusters at the twig ends, and a thin
// rim of light runs along their tops when the sun is behind
function laTree(x, y, h, seed, o = {}) {
  const r = mulberry(seed);
  const bark = o.bark || '#120e0b', leaf = o.leaf || bark;
  const seg = [], tips = [];
  const grow = (x0, y0, a, len, w, d) => {
    const x1 = x0 + Math.sin(a) * len, y1 = y0 - Math.cos(a) * len;
    const k = (r() - 0.5) * 0.4 * len;
    seg.push(`<path d="M${fx1(x0)},${fx1(y0)}Q${fx1((x0 + x1) / 2 + Math.cos(a) * k)},${fx1((y0 + y1) / 2 + Math.sin(a) * k)} ${fx1(x1)},${fx1(y1)}" stroke-width="${fx1(Math.max(0.5, w))}"/>`);
    if (d === 0) { tips.push([x1, y1]); return; }
    const n = d >= (o.fork ?? 4) ? 2 : r() < 0.5 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1) - 0.5;
      grow(x1, y1, a * (o.keep ?? 0.82) + t * (o.spread ?? 1.2) + (r() - 0.5) * 0.35, len * (0.72 + r() * 0.1), w * 0.66, d - 1);
    }
  };
  grow(x, y, (r() - 0.5) * 0.06, h * (o.trunk ?? 0.27), h * (o.thick ?? 0.062), o.depth ?? 6);
  const tw = h * (o.thick ?? 0.062);
  let s = `<path d="M${fx1(x - tw * 1.8)},${fx1(y + 3)}Q${fx1(x - tw * 0.55)},${fx1(y - h * 0.035)} ${fx1(x - tw * 0.5)},${fx1(y - h * 0.12)}L${fx1(x + tw * 0.5)},${fx1(y - h * 0.12)}Q${fx1(x + tw * 0.55)},${fx1(y - h * 0.035)} ${fx1(x + tw * 1.9)},${fx1(y + 3)}Z" fill="${bark}"/>`;
  s += `<g fill="none" stroke="${bark}" stroke-linecap="round">${seg.join('')}</g>`;
  const blobs = [];
  for (const [tx, ty] of tips) for (let j = 0; j < (o.per ?? 3); j++) blobs.push([tx + (r() - 0.5) * h * 0.07, ty + (r() - 0.5) * h * 0.05, h * (0.02 + r() * 0.026)]);
  const circles = (dx, dy) => blobs.map(([bx, by, br]) => `<circle cx="${fx1(bx + dx)}" cy="${fx1(by + dy)}" r="${fx1(br)}"/>`).join('');
  if (o.rim) s += `<g fill="${o.rim}" opacity="${o.rimOp ?? 0.7}">${circles(h * (o.rx ?? 0.004), -h * 0.01)}</g>`;
  return s + `<g fill="${leaf}">${circles(0, 0)}</g>`;
}
// a pine for the north: stacked, ragged tiers
function laPine(x, y, h, col, r) {
  const w = h * 0.36;
  let d = `M${fx1(x)},${fx1(y - h)}`;
  const tiers = 5;
  for (let i = 1; i <= tiers; i++) { const t = i / tiers, ty = y - h + h * t * 0.92, tw = w * t * (0.75 + r() * 0.3); d += `L${fx1(x + tw)},${fx1(ty)}L${fx1(x + tw * 0.42)},${fx1(ty - h * 0.05)}`; }
  d += `L${fx1(x + w * 0.1)},${fx1(y)}L${fx1(x - w * 0.1)},${fx1(y)}`;
  for (let i = tiers; i >= 1; i--) { const t = i / tiers, ty = y - h + h * t * 0.92, tw = w * t * (0.75 + r() * 0.3); d += `L${fx1(x - tw * 0.42)},${fx1(ty - h * 0.05)}L${fx1(x - tw)},${fx1(ty)}`; }
  return `<path d="${d}Z" fill="${col}"/>`;
}
// a battlemented block: merlons along the top edge, both ends up
function laBattle(x0, x1, yTop, yBot, mw, mh) {
  const n = Math.max(1, Math.round((x1 - x0) / (mw * 2)));
  const step = (x1 - x0) / (n * 2 - 1);
  let d = `M${fx1(x0)},${fx1(yBot)}`;
  for (let i = 0; i < n * 2 - 1; i++) {
    const xa = x0 + i * step, yy = i % 2 === 0 ? yTop - mh : yTop;
    d += `L${fx1(xa)},${fx1(yy)}L${fx1(xa + step)},${fx1(yy)}`;
  }
  return d + `L${fx1(x1)},${fx1(yBot)}Z`;
}
// a flag on a pole that ripples in the wind
function laBanner(x, gy, h, col, o = {}) {
  const fw = o.w || h * 0.34, fh = o.fh || h * 0.4, top = gy - h;
  const f = o.left ? -1 : 1, X = (v) => fx1(x + v * f);
  return `<path d="M${fx1(x)},${fx1(gy)}V${fx1(top - 2)}" stroke="${o.pole || '#16110d'}" stroke-width="${fx1(o.pw || Math.max(1.3, h * 0.02))}"/>`
    + `<g class="la-flag" style="animation-delay:${fx1(o.delay || 0)}s${o.left ? ';transform-origin:100% 50%' : ''}"><path d="M${X(0)},${fx1(top)}C${X(fw * 0.4)},${fx1(top - 4)} ${X(fw * 0.7)},${fx1(top + 5)} ${X(fw)},${fx1(top + 2)}L${X(fw * 0.8)},${fx1(top + fh * 0.52)}L${X(fw)},${fx1(top + fh)}C${X(fw * 0.62)},${fx1(top + fh + 5)} ${X(fw * 0.3)},${fx1(top + fh - 4)} ${X(0)},${fx1(top + fh)}Z" fill="${col}"/>`
    + (o.mark ? `<circle cx="${X(fw * 0.4)}" cy="${fx1(top + fh * 0.48)}" r="${fx1(fh * 0.17)}" fill="none" stroke="${o.mark}" stroke-width="${fx1(Math.max(0.8, fh * 0.06))}" opacity="0.8"/>` : '') + '</g>';
}
// a keep in its realm's manner: square stone (Logres), a ringfort (Ériu) or a timber hold (Thule);
// returns the silhouette, the gate and where banners fly
function laKeep(style, cx, gy, s, col) {
  const out = [], tops = [];
  const B = (a, b, t, bot, mw, mh) => out.push(`<path d="${laBattle(cx + a * s, cx + b * s, gy - t * s, gy - bot * s, mw * s, mh * s)}"/>`);
  if (style === 'stone') {
    B(-44, 44, 138, 30, 6.5, 9);
    B(-112, 112, 54, 0, 7, 8);
    for (const dx of [-118, 118]) B(dx - 17, dx + 17, 96, 0, 5.5, 9);
    for (const dx of [-30, 30]) B(dx - 13, dx + 13, 78, 0, 4.5, 8);
    tops.push([cx, gy - 147 * s], [cx - 118 * s, gy - 105 * s], [cx + 118 * s, gy - 105 * s]);
  } else if (style === 'round') {
    // a round wall of mossy stone around a tall round tower with a conical cap
    out.push(`<path d="M${fx1(cx - 26 * s)},${fx1(gy - 40 * s)}V${fx1(gy - 118 * s)}L${fx1(cx)},${fx1(gy - 162 * s)}L${fx1(cx + 26 * s)},${fx1(gy - 118 * s)}V${fx1(gy - 40 * s)}Z"/>`);
    out.push(`<path d="M${fx1(cx - 72 * s)},${fx1(gy - 30 * s)}Q${fx1(cx - 60 * s)},${fx1(gy - 98 * s)} ${fx1(cx - 40 * s)},${fx1(gy - 70 * s)}L${fx1(cx - 40 * s)},${fx1(gy - 40 * s)}Z"/>`);
    out.push(`<path d="M${fx1(cx - 130 * s)},${fx1(gy)}C${fx1(cx - 130 * s)},${fx1(gy - 44 * s)} ${fx1(cx - 90 * s)},${fx1(gy - 52 * s)} ${fx1(cx)},${fx1(gy - 52 * s)}C${fx1(cx + 90 * s)},${fx1(gy - 52 * s)} ${fx1(cx + 130 * s)},${fx1(gy - 44 * s)} ${fx1(cx + 130 * s)},${fx1(gy)}Z"/>`);
    for (const dx of [-34, 34]) out.push(`<path d="M${fx1(cx + (dx - 14) * s)},${fx1(gy)}V${fx1(gy - 70 * s)}L${fx1(cx + dx * s)},${fx1(gy - 92 * s)}L${fx1(cx + (dx + 14) * s)},${fx1(gy - 70 * s)}V${fx1(gy)}Z"/>`);
    tops.push([cx, gy - 162 * s], [cx - 34 * s, gy - 92 * s], [cx + 34 * s, gy - 92 * s]);
  } else {
    // a palisade of sharpened stakes, two watchtowers and a steep-roofed hall
    out.push(`<path d="M${fx1(cx - 70 * s)},${fx1(gy - 60 * s)}L${fx1(cx - 20 * s)},${fx1(gy - 126 * s)}L${fx1(cx + 20 * s)},${fx1(gy - 126 * s)}L${fx1(cx + 70 * s)},${fx1(gy - 60 * s)}Z"/>`);
    out.push(`<path d="M${fx1(cx - 26 * s)},${fx1(gy - 126 * s)}l${fx1(-8 * s)},${fx1(-12 * s)}M${fx1(cx + 26 * s)},${fx1(gy - 126 * s)}l${fx1(8 * s)},${fx1(-12 * s)}" stroke="${col}" stroke-width="${fx1(4 * s)}"/>`);
    let st = `M${fx1(cx - 125 * s)},${fx1(gy)}`;
    for (let x = -125; x < 125; x += 9) st += `L${fx1(cx + x * s)},${fx1(gy - 50 * s)}L${fx1(cx + (x + 4.5) * s)},${fx1(gy - 58 * s)}L${fx1(cx + (x + 9) * s)},${fx1(gy - 50 * s)}`;
    out.push(`<path d="${st}L${fx1(cx + 125 * s)},${fx1(gy)}Z"/>`);
    for (const dx of [-36, 36]) out.push(`<path d="M${fx1(cx + (dx - 13) * s)},${fx1(gy)}V${fx1(gy - 84 * s)}H${fx1(cx + (dx - 17) * s)}L${fx1(cx + dx * s)},${fx1(gy - 106 * s)}L${fx1(cx + (dx + 17) * s)},${fx1(gy - 84 * s)}H${fx1(cx + (dx + 13) * s)}V${fx1(gy)}Z"/>`);
    tops.push([cx, gy - 132 * s], [cx - 36 * s, gy - 106 * s], [cx + 36 * s, gy - 106 * s]);
  }
  return { svg: `<g fill="${col}">${out.join('')}</g>`, gate: [cx, gy], gw: (style === 'stone' ? 15 : 13) * s, gh: (style === 'stone' ? 40 : 36) * s, tops };
}
// a soldier in silhouette; face 1 looks right, -1 left
function laSoldier(x, gy, s, col, face, kind, r) {
  const X = (v) => fx1(x + v * s * face), Y = (v) => fx1(gy - v * s);
  const lean = (r() - 0.5) * 3;
  let o = `<path d="M${X(-6)},${Y(0)}L${X(-3.5)},${Y(15)}L${X(-6.5 + lean)},${Y(29)}Q${X(lean)},${Y(34)} ${X(6.5 + lean)},${Y(29)}L${X(4)},${Y(15)}L${X(6.5)},${Y(0)}L${X(2)},${Y(0)}L${X(0.5)},${Y(11)}L${X(-1.5)},${Y(0)}Z"/>`;
  o += `<circle cx="${X(lean + 0.8)}" cy="${Y(37.5)}" r="${fx1(4.6 * s)}"/>`;
  if (kind === 'spear') o += `<path d="M${X(5)},${Y(3)}L${X(15 + lean)},${Y(64)}" stroke="${col}" stroke-width="${fx1(1.7 * s)}"/><path d="M${X(15 + lean)},${Y(64)}l${fx1(0.6 * s * face)},${fx1(-7 * s)}l${fx1(1.8 * s * face)},${fx1(7.4 * s)}Z"/>`;
  if (kind === 'sword') o += `<path d="M${X(6)},${Y(22)}L${X(17)},${Y(46)}" stroke="${col}" stroke-width="${fx1(1.8 * s)}"/>`;
  if (kind === 'bow') o += `<path d="M${X(9)},${Y(50)}Q${X(19)},${Y(30)} ${X(9)},${Y(10)}" fill="none" stroke="${col}" stroke-width="${fx1(1.5 * s)}"/>`;
  if (kind !== 'bow') o += `<ellipse cx="${X(7.5 + lean * 0.5)}" cy="${Y(21)}" rx="${fx1(5.2 * s)}" ry="${fx1(8.4 * s)}"/>`;
  return o;
}
// the hero seen from behind, cloaked, carrying the arms of their calling; lit from the right
function laHero(x, gy, h, cls, cloak, rim, metal) {
  const s = h / 100, X = (v) => fx1(x + v * s), Y = (v) => fx1(gy - v * s), W = (v) => fx1(v * s);
  const dark = laShade(cloak, 0.62), wood = '#2b1e14';
  let back = '', front = '';
  // what is slung on the back goes behind the cloak; what is held goes in front
  if (cls === 'archer') {
    back += `<path d="M${X(-21)},${Y(98)}Q${X(2)},${Y(72)} ${X(19)},${Y(30)}" fill="none" stroke="${wood}" stroke-width="${W(2.8)}" stroke-linecap="round"/><path d="M${X(-21)},${Y(98)}L${X(19)},${Y(30)}" stroke="#d8cbb0" stroke-width="${W(0.6)}" stroke-opacity="0.6"/>`;
    front += `<path d="M${X(6)},${Y(86)}L${X(14)},${Y(50)}L${X(21)},${Y(52)}L${X(13)},${Y(88)}Z" fill="#3a2414"/><path d="M${X(7)},${Y(87)}l${W(-1)},${W(-7)}M${X(10)},${Y(88)}l${W(0)},${W(-8)}M${X(12.5)},${Y(88.5)}l${W(1)},${W(-7)}" stroke="#e6d9be" stroke-width="${W(1.1)}" stroke-linecap="round"/>`;
  }
  if (cls === 'mage') front += `<path d="M${X(21)},${Y(-1)}L${X(26)},${Y(116)}" stroke="${wood}" stroke-width="${W(2.4)}" stroke-linecap="round"/><circle cx="${X(26.2)}" cy="${Y(119)}" r="${W(13)}" fill="url(#lr-orb)"/><circle cx="${X(26.2)}" cy="${Y(119)}" r="${W(3.6)}" fill="#dff1ff" class="la-pulse"/>`;
  if (cls === 'priest') front += `<path d="M${X(21)},${Y(46)}L${X(25)},${Y(20)}" stroke="${wood}" stroke-width="${W(2.4)}" stroke-linecap="round"/><circle cx="${X(25.6)}" cy="${Y(17)}" r="${W(4.4)}" fill="${metal}"/><path d="M${X(25.6)},${Y(23)}v${W(12)}M${X(19.6)},${Y(17)}h${W(12)}" stroke="${metal}" stroke-width="${W(1.4)}"/>`;
  if (cls === 'warrior') {
    front += `<path d="M${X(-17)},${Y(44)}L${X(-25)},${Y(10)}" stroke="${metal}" stroke-width="${W(2.6)}" stroke-linecap="round"/><path d="M${X(-20)},${Y(46)}L${X(-13)},${Y(42)}" stroke="${wood}" stroke-width="${W(2.6)}" stroke-linecap="round"/><circle cx="${X(-16)}" cy="${Y(47)}" r="${W(1.8)}" fill="${metal}"/>`;
  }
  const boots = `<path d="M${X(-11)},${Y(1)}q${W(3)},${W(-6)} ${W(8)},${W(-2)}v${W(3)}h${W(-8)}zM${X(4)},${Y(1)}q${W(3)},${W(-6)} ${W(8)},${W(-2)}v${W(3)}h${W(-8)}z" fill="#141010"/>`;
  const body = `<path d="M${X(-7)},${Y(83)}C${X(-12)},${Y(82)} ${X(-17)},${Y(79)} ${X(-18)},${Y(72)}C${X(-20)},${Y(52)} ${X(-23)},${Y(24)} ${X(-25)},${Y(2)}Q${X(0)},${Y(-2)} ${X(25)},${Y(2)}C${X(23)},${Y(24)} ${X(20)},${Y(52)} ${X(18)},${Y(72)}C${X(17)},${Y(79)} ${X(12)},${Y(82)} ${X(7)},${Y(83)}Z" fill="${cloak}"/>`;
  const shade = `<path d="M${X(-7)},${Y(83)}C${X(-12)},${Y(82)} ${X(-17)},${Y(79)} ${X(-18)},${Y(72)}C${X(-20)},${Y(52)} ${X(-23)},${Y(24)} ${X(-25)},${Y(2)}Q${X(-12)},${Y(0)} ${X(-4)},${Y(-0.5)}C${X(-6)},${Y(30)} ${X(-5)},${Y(60)} ${X(-2)},${Y(82)}Z" fill="${dark}" opacity="0.7"/>`;
  const folds = `<path d="M${X(-9)},${Y(70)}C${X(-11)},${Y(48)} ${X(-14)},${Y(24)} ${X(-15)},${Y(1)}M${X(3)},${Y(74)}C${X(4)},${Y(50)} ${X(6)},${Y(24)} ${X(7)},${Y(0)}M${X(12)},${Y(66)}C${X(14)},${Y(44)} ${X(16)},${Y(22)} ${X(17)},${Y(1)}" fill="none" stroke="#000" stroke-opacity="0.25" stroke-width="${W(1.3)}"/>`;
  const roll = cls === 'warrior' ? '' : `<path d="M${X(-15)},${Y(74)}C${X(-15)},${Y(80)} ${X(15)},${Y(80)} ${X(15)},${Y(74)}C${X(15)},${Y(68)} ${X(-15)},${Y(68)} ${X(-15)},${Y(74)}Z" fill="#5a4a36"/><path d="M${X(-6)},${Y(79.5)}v${W(-11)}M${X(6)},${Y(79.5)}v${W(-11)}" stroke="#2a2016" stroke-width="${W(1.6)}"/><path d="M${X(4)},${Y(79)}C${X(10)},${Y(78.5)} ${X(14)},${Y(77)} ${X(15)},${Y(74)}" fill="none" stroke="${rim}" stroke-opacity="0.6" stroke-width="${W(1)}"/>`;
  const shield = cls === 'warrior' ? `<circle cx="${X(1)}" cy="${Y(55)}" r="${W(15)}" fill="#3a2a1b"/><circle cx="${X(1)}" cy="${Y(55)}" r="${W(15)}" fill="none" stroke="${metal}" stroke-width="${W(2)}"/><path d="M${X(1)},${Y(40)}v${W(30)}M${X(-14)},${Y(55)}h${W(30)}" stroke="${laShade(cloak, 1.3)}" stroke-width="${W(3)}" opacity="0.8"/><circle cx="${X(1)}" cy="${Y(55)}" r="${W(3.6)}" fill="${metal}"/>` : '';
  const emblem = cls === 'priest' ? `<circle cx="${X(0)}" cy="${Y(56)}" r="${W(6)}" fill="none" stroke="${metal}" stroke-width="${W(1.4)}" opacity="0.8"/><path d="M${X(0)},${Y(46)}v${W(20)}M${X(-10)},${Y(56)}h${W(20)}" stroke="${metal}" stroke-width="${W(1.1)}" opacity="0.6"/>` : '';
  const head = cls === 'warrior'
    ? `<path d="M${X(-8)},${Y(82)}C${X(-9.5)},${Y(92)} ${X(-6)},${Y(101)} ${X(0)},${Y(101)}C${X(6)},${Y(101)} ${X(9.5)},${Y(92)} ${X(8)},${Y(82)}C${X(4)},${Y(80)} ${X(-4)},${Y(80)} ${X(-8)},${Y(82)}Z" fill="#53575c"/><path d="M${X(3)},${Y(100)}C${X(7)},${Y(97)} ${X(9)},${Y(90)} ${X(8)},${Y(83)}" fill="none" stroke="${rim}" stroke-width="${W(1.2)}" stroke-opacity="0.7"/>`
    : `<path d="M${X(-9)},${Y(80)}C${X(-11.5)},${Y(91)} ${X(-7.5)},${Y(102)} ${X(0)},${Y(103)}C${X(7.5)},${Y(102)} ${X(11.5)},${Y(91)} ${X(9)},${Y(80)}C${X(5)},${Y(77)} ${X(-5)},${Y(77)} ${X(-9)},${Y(80)}Z" fill="${laShade(cloak, 0.9)}"/><path d="M${X(-1)},${Y(102)}C${X(-4)},${Y(94)} ${X(-4)},${Y(86)} ${X(-2)},${Y(80)}" fill="none" stroke="#000" stroke-opacity="0.3" stroke-width="${W(1.2)}"/>`;
  const edge = `<path d="M${X(12)},${Y(82)}C${X(16)},${Y(80)} ${X(17.5)},${Y(76)} ${X(18)},${Y(72)}C${X(20)},${Y(52)} ${X(23)},${Y(24)} ${X(25)},${Y(2)}" fill="none" stroke="${rim}" stroke-width="${W(1.6)}" stroke-opacity="0.8"/>`
    + (cls === 'warrior' ? '' : `<path d="M${X(4)},${Y(102)}C${X(9)},${Y(99)} ${X(11.5)},${Y(91)} ${X(9.5)},${Y(81)}" fill="none" stroke="${rim}" stroke-width="${W(1.3)}" stroke-opacity="0.7"/>`);
  return back + boots + body + shade + folds + shield + emblem + roll + head + edge + front;
}
function loreArt(id, realm, cls) {
  const R = REALMS[realm] || REALMS[0];
  const head = '<svg viewBox="0 0 800 600" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true" focusable="false">';
  if (id === 'march') return head + laMarch() + '</svg>';
  if (id === 'hallows') return head + laHallows() + '</svg>';
  if (id === 'war') return head + laWar(realm) + '</svg>';
  if (id === 'wilds') return head + laWilds() + '</svg>';
  return head + laRoad(R, cls) + '</svg>';
}

// I. the March at dusk: the ring of mountains, the passes, the hill and its tree
function laMarch() {
  const r = mulberry(11);
  let s = `<defs>
    <linearGradient id="lm-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#090e1e"/><stop offset="0.34" stop-color="#20223d"/><stop offset="0.54" stop-color="#4f3d5a"/><stop offset="0.66" stop-color="#a1645a"/><stop offset="0.75" stop-color="#e29c62"/><stop offset="0.82" stop-color="#f6cb88"/></linearGradient>
    <radialGradient id="lm-sun" cx="0.5" cy="0.76" r="0.5"><stop offset="0" stop-color="#fff0c4" stop-opacity="1"/><stop offset="0.12" stop-color="#ffc98a" stop-opacity="0.7"/><stop offset="0.4" stop-color="#f09a62" stop-opacity="0.22"/><stop offset="1" stop-color="#f09a62" stop-opacity="0"/></radialGradient>
    <linearGradient id="lm-haze" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8a070" stop-opacity="0"/><stop offset="1" stop-color="#d08a68" stop-opacity="0.55"/></linearGradient>
    <linearGradient id="lm-hill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a3523"/><stop offset="0.3" stop-color="#18200f"/><stop offset="1" stop-color="#0b0f0a"/></linearGradient>
    <linearGradient id="lm-path" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9a774" stop-opacity="0.05"/><stop offset="1" stop-color="#b48a62" stop-opacity="0.32"/></linearGradient>
  </defs>
  <rect width="800" height="600" fill="url(#lm-sky)"/><rect width="800" height="600" fill="url(#lm-sun)"/>`;
  s += laStars(r, 90, 270, 0.9);
  // the ring of mountains with two of its three passes; the third lies behind you
  const far = laRidge({ seed: 3.1, y: 478, amp: 330, freq: 0.0072, sharp: true, notch: [[178, 30, 436], [622, 30, 438]] });
  s += `<path d="${laArea(far)}" fill="#4a3f60"/><path d="${laSnowcap(far, 372, 34, 4)}" fill="#efc1a8" opacity="0.72"/>`;
  s += `<rect y="350" width="800" height="150" fill="url(#lm-haze)"/>`;
  const mid = laRidge({ seed: 7.7, y: 498, amp: 78, freq: 0.006, notch: [[178, 44, 462], [622, 44, 464]] });
  s += `<path d="${laArea(mid)}" fill="#332d40"/>`;
  s += laBanner(180, 458, 34, '#2f9a6a', { pw: 1.3, delay: -0.4 }) + laBanner(624, 460, 34, '#4d7fcb', { pw: 1.3, delay: -1.1 });
  s += `<rect y="440" width="800" height="80" fill="url(#lm-haze)" opacity="0.55"/>`;
  const near = laRidge({ seed: 12.3, y: 552, amp: 46, freq: 0.005 });
  s += `<path d="${laArea(near)}" fill="#1d2027"/>`;
  // the hill at the heart of the March, and its one tree
  s += `<path d="M180,620C262,526 336,470 400,466C464,470 538,526 620,620Z" fill="url(#lm-hill)"/>`;
  s += laTree(400, 469, 188, 5, { bark: '#0d0a08', leaf: '#101710', rim: '#ffc58a', rimOp: 0.6 });
  s += `<path d="M352,620C362,590 378,560 384,536C390,512 396,490 398,472L402,472C404,492 404,514 404,538C404,564 424,592 448,620Z" fill="url(#lm-path)"/>`;
  // the foreground: the stones of an older wall, a standard of Logres, long grass
  s += `<path d="M0,566C110,548 200,574 290,606L290,620H0Z" fill="#0b0e0c"/><path d="M800,556C700,550 620,576 520,612L520,620H800Z" fill="#0b0e0c"/>`;
  s += '<g fill="#161a1c">' + [[110, 556, 22, 30], [136, 562, 18, 20], [160, 556, 16, 38], [180, 566, 24, 14]].map(([x, y, w, h]) => `<path d="M${x},${y + h}V${y}l${fx1(w * 0.3)},-4l${fx1(w * 0.4)},3l${fx1(w * 0.3)},-2V${y + h}Z"/>`).join('') + '</g>';
  s += laBanner(596, 586, 128, '#c9483b', { delay: -0.7, mark: '#f2c46b' });
  for (let i = 0; i < 5; i++) { const bx = 470 + r() * 120, by = 228 + r() * 60, w = 4 + r() * 4; s += `<path d="M${fx1(bx - w)},${fx1(by)}q${fx1(w * 0.5)},${fx1(-w * 0.5)} ${fx1(w)},0q${fx1(w * 0.5)},${fx1(-w * 0.5)} ${fx1(w)},0" fill="none" stroke="#1a1416" stroke-width="1.3"/>`; }
  for (let i = 0; i < 60; i++) { const gx = r() * 800, gy2 = 590 + r() * 14; s += `<path d="M${fx1(gx)},${fx1(gy2 + 12)}q${fx1((r() - 0.3) * 6)},${fx1(-10 - r() * 14)} ${fx1((r() - 0.5) * 8)},${fx1(-16 - r() * 16)}" stroke="#070908" stroke-width="2" fill="none"/>`; }
  return s;
}

// II. the hall under the hill, long ago: the king on his throne binds the three hallows to himself
function laHallows() {
  const r = mulberry(23);
  const H = [{ x: 222, y: 232, c: '#f0b45c', g: '#ffd27e' }, { x: 400, y: 116, c: '#4cc890', g: '#86ffc8' }, { x: 578, y: 232, c: '#6f9cf0', g: '#b0ccff' }];
  const to = [[352, 252], [400, 236], [448, 252]];
  let s = `<defs>
    <radialGradient id="lh-bg" cx="0.5" cy="0.4" r="0.75"><stop offset="0" stop-color="#2e231b"/><stop offset="0.5" stop-color="#140f0c"/><stop offset="1" stop-color="#050406"/></radialGradient>
    ${H.map((h, i) => `<radialGradient id="lh-glow${i}"><stop offset="0" stop-color="${h.g}" stop-opacity="0.9"/><stop offset="0.28" stop-color="${h.c}" stop-opacity="0.34"/><stop offset="1" stop-color="${h.c}" stop-opacity="0"/></radialGradient><linearGradient id="lh-tie${i}" gradientUnits="userSpaceOnUse" x1="${h.x}" y1="${h.y}" x2="${to[i][0]}" y2="${to[i][1]}"><stop offset="0" stop-color="${h.g}" stop-opacity="0.9"/><stop offset="1" stop-color="${h.g}" stop-opacity="0.15"/></linearGradient>`).join('')}
    <radialGradient id="lh-king" cx="0.5" cy="0.45" r="0.5"><stop offset="0" stop-color="#ffe6b0" stop-opacity="0.32"/><stop offset="1" stop-color="#ffe6b0" stop-opacity="0"/></radialGradient>
    <linearGradient id="lh-floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a1410"/><stop offset="1" stop-color="#0a0807"/></linearGradient>
  </defs><rect width="800" height="600" fill="url(#lh-bg)"/>`;
  // the vault: the far wall, rows of pillars and arches going back into the dark
  s += `<path d="M250,440V170Q400,96 550,170V440Z" fill="#1a1411"/>`;
  const pillar = (x, top, w, col) => `<path d="M${x - w},440V${top}h${w * 2}V440Z" fill="${col}"/><path d="M${x - w * 1.3},${top}h${w * 2.6}v-${fx1(w * 0.7)}h-${w * 2.6}z" fill="${col}"/>`;
  [[275, 186, 9, '#1d1612'], [525, 186, 9, '#1d1612'], [205, 130, 14, '#171210'], [595, 130, 14, '#171210'], [110, 50, 24, '#100c0a'], [690, 50, 24, '#100c0a']].forEach(([x, t, w, c]) => { s += pillar(x, t, w, c); });
  s += `<path d="M110,50Q400,-60 690,50" fill="none" stroke="#100c0a" stroke-width="30"/><path d="M205,130Q400,40 595,130" fill="none" stroke="#171210" stroke-width="18"/>`;
  s += `<path d="M0,440H800V600H0Z" fill="url(#lh-floor)"/>`;
  for (let i = -9; i <= 9; i++) s += `<path d="M${400 + i * 26},440L${400 + i * 160},600" stroke="#2a201a" stroke-width="1"/>`;
  for (const y of [452, 470, 496, 532, 584]) s += `<path d="M0,${y}H800" stroke="#231b16" stroke-width="1"/>`;
  // the dais and the throne
  s += `<path d="M262,474h276l-24,-17h-228zM290,457h220l-20,-17h-180z" fill="#271e17"/><path d="M262,474h276" stroke="#4a3a2c" stroke-width="1.5"/>`;
  s += `<ellipse cx="400" cy="300" rx="150" ry="170" fill="url(#lh-king)"/>`;
  s += `<path d="M346,440V246Q346,206 400,184Q454,206 454,246V440Z" fill="#120d0a"/><path d="M400,184l-8,-16l8,-12l8,12z" fill="#120d0a"/>`;
  s += `<path d="M332,440V362h22v78zM446,440V362h22v78z" fill="#1a1310"/>`;
  // the king: robed, crowned, arms raised to the hallows
  s += `<path d="M366,440C364,404 368,352 372,312Q378,290 400,288Q422,290 428,312C432,352 436,404 434,440Z" fill="#1d1612"/>`;
  s += `<path d="M378,296Q366,276 350,250L344,254L340,262Q350,290 366,318ZM422,296Q434,276 450,250L456,254L460,262Q450,290 434,318Z" fill="#1d1612"/><path d="M350,250l-4,-8l7,3zM450,250l4,-8l-7,3z" fill="#2a211b"/>`;
  s += `<circle cx="400" cy="270" r="13" fill="#221a15"/><path d="M386,262l3,-14l6,9l5,-13l5,13l6,-9l3,14z" fill="#c9a24e"/>`;
  s += `<path d="M386,262l3,-14l6,9l5,-13l5,13l6,-9l3,14" fill="none" stroke="#fff0c0" stroke-opacity="0.5" stroke-width="1"/>`;
  // the bindings: light drawn out of each hallow into the king
  H.forEach((h, i) => {
    const [tx, ty] = to[i], mx = (h.x + tx) / 2 + (i === 1 ? 26 : 0), my = (h.y + ty) / 2 - 30;
    const d = `M${h.x},${h.y}Q${fx1(mx)},${fx1(my)} ${tx},${ty}`;
    s += `<path d="${d}" fill="none" stroke="${h.g}" stroke-opacity="0.18" stroke-width="10" stroke-linecap="round"/><path d="${d}" fill="none" stroke="url(#lh-tie${i})" stroke-width="2.2" stroke-linecap="round" class="la-pulse" style="animation-delay:${-i * 0.6}s"/>`;
  });
  // the Grail
  s += `<circle cx="222" cy="232" r="84" fill="url(#lh-glow0)" class="la-pulse"/><path d="M198,206h48q-2,32 -24,38q-22,-6 -24,-38z" fill="#e8ba5e"/><path d="M218,244h8v16h-8z" fill="#c9963e"/><path d="M205,268q17,-12 34,0z" fill="#c9963e"/><path d="M201,210h42" stroke="#fff3c8" stroke-width="2" opacity="0.65"/>`;
  // the stone that names kings
  s += `<circle cx="400" cy="116" r="80" fill="url(#lh-glow1)" class="la-pulse" style="animation-delay:-0.9s"/><path d="M384,160C380,130 382,94 392,74C400,68 410,74 414,86C420,110 420,138 416,160Z" fill="#71877a"/><path d="M398,98q8,5 2,13q-10,4 -10,-6q2,-13 15,-11q13,6 7,22" fill="none" stroke="#c4ffe6" stroke-width="1.8" opacity="0.8"/><path d="M389,160C386,132 388,98 395,80" stroke="#d2ffea" stroke-opacity="0.35" stroke-width="2" fill="none"/>`;
  // the ring
  s += `<circle cx="578" cy="232" r="84" fill="url(#lh-glow2)" class="la-pulse" style="animation-delay:-1.7s"/><ellipse cx="578" cy="234" rx="28" ry="20" fill="none" stroke="#e2bf6a" stroke-width="8.5"/><ellipse cx="578" cy="234" rx="28" ry="20" fill="none" stroke="#fff3c8" stroke-width="1.8" stroke-dasharray="4 5" opacity="0.75"/>`;
  // reflections on the floor and dust in the air
  H.forEach((h) => { s += `<ellipse cx="${h.x}" cy="520" rx="70" ry="10" fill="${h.g}" opacity="0.08"/>`; });
  for (let i = 0; i < 70; i++) { const h = H[i % 3]; s += `<circle cx="${fx1(h.x + (r() - 0.5) * 140)}" cy="${fx1(h.y + (r() - 0.5) * 160)}" r="${fx1(0.6 + r() * 1.1)}" fill="${h.g}" opacity="${fx1(0.2 + r() * 0.5)}" class="la-tw" style="animation-delay:${fx1(-r() * 3)}s"/>`; }
  return s;
}
// III. a siege at sunset: a warband of your realm at the burning gate of an enemy keep
function laWar(realm) {
  const r = mulberry(31);
  const me = REALMS[realm] || REALMS[0], foe = REALMS[(me.id + 1) % 3], foe2 = REALMS[(me.id + 2) % 3];
  let s = `<defs>
    <linearGradient id="lw-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#150e13"/><stop offset="0.34" stop-color="#3b1c20"/><stop offset="0.56" stop-color="#8e3624"/><stop offset="0.68" stop-color="#d2652e"/><stop offset="0.76" stop-color="#f2a656"/></linearGradient>
    <radialGradient id="lw-sun" cx="0.78" cy="0.66" r="0.5"><stop offset="0" stop-color="#ffd890" stop-opacity="0.9"/><stop offset="0.2" stop-color="#ff9a50" stop-opacity="0.35"/><stop offset="1" stop-color="#ff9a50" stop-opacity="0"/></radialGradient>
    <radialGradient id="lw-fire"><stop offset="0" stop-color="#fff0b0"/><stop offset="0.25" stop-color="#ffb040" stop-opacity="0.9"/><stop offset="0.6" stop-color="#e05a1a" stop-opacity="0.35"/><stop offset="1" stop-color="#e05a1a" stop-opacity="0"/></radialGradient>
    <radialGradient id="lw-smoke"><stop offset="0" stop-color="#2a1d1c" stop-opacity="0.75"/><stop offset="1" stop-color="#2a1d1c" stop-opacity="0"/></radialGradient>
  </defs><rect width="800" height="600" fill="url(#lw-sky)"/><rect width="800" height="600" fill="url(#lw-sun)"/>`;
  s += `<circle cx="624" cy="396" r="34" fill="#ffd28a" opacity="0.85"/>`;
  for (let i = 0; i < 9; i++) s += `<circle class="la-drift" style="animation-delay:${fx1(-i * 1.7)}s" cx="${fx1(290 + i * 26 + r() * 30)}" cy="${fx1(318 - i * 34 - r() * 20)}" r="${fx1(40 + i * 12)}" fill="url(#lw-smoke)"/>`;
  const far = laRidge({ seed: 9.2, y: 430, amp: 60, freq: 0.006 });
  s += `<path d="${laArea(far)}" fill="#4a2424"/>`;
  // a far temple on its hill, its hallow glowing
  s += `<path d="M560,440q66,-42 150,-6v30h-150z" fill="#3a1c1e"/><path d="M622,414l28,-16l28,16zM626,414h48v14h-48z" fill="#2a1416"/><circle cx="650" cy="408" r="14" fill="url(#lw-fire)" opacity="0.9" class="la-pulse"/>`;
  s += laBanner(684, 420, 34, foe2.color, { pw: 1.2, delay: -0.5 });
  const mid = laRidge({ seed: 4.4, y: 470, amp: 40, freq: 0.005 });
  s += `<path d="${laArea(mid)}" fill="#2c1718"/>`;
  // the keep on its rise
  s += `<path d="M40,620C110,516 196,474 300,468C404,474 470,516 540,620Z" fill="#1b1012"/>`;
  const K = laKeep(foe.style, 290, 474, 1.15, '#150c0e');
  s += K.svg;
  K.tops.forEach(([x, y], i) => { s += laBanner(x, y + 2, 36 + (i ? 0 : 10), foe.color, { pw: 1.5, delay: -i * 0.6 }); });
  s += `<circle cx="${K.gate[0]}" cy="${K.gate[1] - 18}" r="78" fill="url(#lw-fire)" class="la-fire"/>`;
  s += `<path d="M${fx1(K.gate[0] - K.gw)},${K.gate[1]}V${fx1(K.gate[1] - K.gh * 0.62)}a${fx1(K.gw)},${fx1(K.gw)} 0 0 1 ${fx1(K.gw * 2)},0V${K.gate[1]}Z" fill="#ffb24a" class="la-fire"/>`;
  for (let i = 0; i < 16; i++) s += `<circle class="la-rise" style="animation-delay:${fx1(-r() * 5)}s" cx="${fx1(K.gate[0] + (r() - 0.5) * 50)}" cy="${fx1(K.gate[1] - 10 - r() * 40)}" r="${fx1(0.8 + r() * 1.4)}" fill="#ffd27a"/>`;
  // a volley from the walls onto the band, and the band's archers shooting back
  const arrow = (x, y, dx, dy) => { const l = Math.hypot(dx, dy), ux = dx / l, uy = dy / l; return `<path d="M${fx1(x)},${fx1(y)}l${fx1(ux * 15)},${fx1(uy * 15)}" stroke="#1a0d0d" stroke-width="1.4"/><path d="M${fx1(x + ux * 15)},${fx1(y + uy * 15)}l${fx1(-ux * 4 - uy * 2)},${fx1(-uy * 4 + ux * 2)}l${fx1(uy * 4)},${fx1(-ux * 4)}z" fill="#1a0d0d"/>`; };
  for (let i = 0; i < 7; i++) { const t = i / 6; s += arrow(372 + t * 92 + r() * 8, 330 + t * 54 + r() * 10, 1, 0.5 + t * 0.35); }
  for (let i = 0; i < 4; i++) s += arrow(500 + i * 22 + r() * 6, 404 - i * 10 + r() * 8, -1, -0.5);
  // the warband: a ram at the gate and the soldiers behind it, your realm's banners over them
  s += `<path d="M328,486h74l-10,-16h-54z" fill="#140b0b"/><path d="M318,490h88" stroke="#140b0b" stroke-width="7"/><circle cx="336" cy="497" r="6.5" fill="#140b0b"/><circle cx="392" cy="497" r="6.5" fill="#140b0b"/>`;
  let band = '';
  const kinds = ['spear', 'sword', 'spear', 'bow', 'spear', 'sword', 'spear', 'bow', 'sword', 'spear', 'spear'];
  for (let i = 0; i < 11; i++) { const row = i % 2, x = 420 + i * 24 + r() * 8, gy = 514 + row * 22 + r() * 4, sc = 1.08 + row * 0.12; band += laSoldier(x, gy, sc, '#120a0b', -1, kinds[i], r); }
  s += `<g fill="#120a0b" stroke-linecap="round">${band}</g>`;
  s += laBanner(512, 514, 122, me.color, { delay: -0.3, mark: me.light, left: true }) + laBanner(612, 538, 104, me.color, { delay: -1.0, left: true });
  s += `<path d="M0,580C160,560 320,574 480,566C620,560 720,572 800,566V600H0Z" fill="#0a0607"/>`;
  for (let i = 0; i < 6; i++) { const x = 60 + r() * 680, y = 586 + r() * 10; s += `<path d="M${fx1(x)},${fx1(y)}l${fx1(-8 + r() * 16)},-46" stroke="#0a0607" stroke-width="2"/>`; }
  return s;
}

// IV. the wilds: Cinderwing over the barrow, snow on the northern peaks, rain and lightning in the south
function laWilds() {
  const r = mulberry(47);
  let s = `<defs>
    <linearGradient id="lx-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a0d13"/><stop offset="0.4" stop-color="#18202b"/><stop offset="0.66" stop-color="#2e3a46"/><stop offset="0.8" stop-color="#46525c"/></linearGradient>
    <radialGradient id="lx-cloud"><stop offset="0" stop-color="#2a323c"/><stop offset="0.7" stop-color="#1c232c" stop-opacity="0.9"/><stop offset="1" stop-color="#1c232c" stop-opacity="0"/></radialGradient>
    <radialGradient id="lx-fire" cx="0.15" cy="0.5" r="0.85"><stop offset="0" stop-color="#fff2b8"/><stop offset="0.25" stop-color="#ffb648" stop-opacity="0.95"/><stop offset="0.65" stop-color="#e2541a" stop-opacity="0.5"/><stop offset="1" stop-color="#b8300e" stop-opacity="0"/></radialGradient>
    <radialGradient id="lx-glow"><stop offset="0" stop-color="#ff9a3a" stop-opacity="0.5"/><stop offset="1" stop-color="#ff9a3a" stop-opacity="0"/></radialGradient>
    <radialGradient id="lx-door"><stop offset="0" stop-color="#c8fff6"/><stop offset="0.35" stop-color="#7fd6d0" stop-opacity="0.7"/><stop offset="1" stop-color="#7fd6d0" stop-opacity="0"/></radialGradient>
    <linearGradient id="lx-wing" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#6a2416"/><stop offset="0.55" stop-color="#2e110d"/><stop offset="1" stop-color="#150909"/></linearGradient>
  </defs><rect width="800" height="600" fill="url(#lx-sky)"/>`;
  s += `<rect width="800" height="600" fill="#cfe0ff" opacity="0" class="la-bolt"/>`;
  for (let i = 0; i < 14; i++) s += `<ellipse class="la-drift" style="animation-delay:${fx1(-r() * 16)}s" cx="${fx1(r() * 860 - 30)}" cy="${fx1(24 + r() * 140)}" rx="${fx1(110 + r() * 120)}" ry="${fx1(40 + r() * 40)}" fill="url(#lx-cloud)"/>`;
  // the north: high snowy peaks and dark pines on the left
  const north = laRidge({ seed: 2.2, y: 468, amp: 260, freq: 0.011, sharp: true, x0: -20, x1: 420 }).map(([x, y]) => [x, lerp(y, 470, sstep(240, 420, x))]);
  s += `<path d="${laArea(north)}" fill="#3e4b5c"/><path d="${laSnowcap(north, 360, 40, 9)}" fill="#e8f0f8" opacity="0.88"/>`;
  const far = laRidge({ seed: 6.6, y: 466, amp: 46, freq: 0.006 });
  s += `<path d="${laArea(far)}" fill="#26303a"/>`;
  let pines = '';
  for (let i = 0; i < 16; i++) pines += laPine(10 + i * 17 + r() * 8, 470 + r() * 10, 26 + r() * 20, '#151d22', r);
  s += pines;
  // the hill of the Lone Tree, far off
  s += `<path d="M150,476C200,446 236,438 270,438C306,440 340,452 380,476Z" fill="#1d252b"/>` + laTree(270, 440, 66, 8, { bark: '#141a1e', depth: 5 });
  // lightning in the south
  const bolt = [[664, 110], [650, 182], [670, 198], [642, 286], [662, 298], [632, 420]];
  s += `<g class="la-bolt"><path d="M${laP(bolt)}" fill="none" stroke="#9fc4ff" stroke-width="9" stroke-opacity="0.35" stroke-linejoin="round"/><path d="M${laP(bolt)}" fill="none" stroke="#f4f8ff" stroke-width="2.4" stroke-linejoin="round"/><path d="M650,182l-24,42l7,4" fill="none" stroke="#e8f0ff" stroke-width="1.4"/></g>`;
  // the barrow mound, its ring of stones and its glowing door
  const mid = laRidge({ seed: 15.5, y: 504, amp: 30, freq: 0.006 });
  s += `<path d="${laArea(mid)}" fill="#18201f"/>`;
  s += `<path d="M290,526C350,462 580,452 680,526Z" fill="#1f2a25"/><path d="M322,500C392,468 560,462 648,500" fill="none" stroke="#6a8a74" stroke-opacity="0.35" stroke-width="2"/>`;
  s += `<circle cx="346" cy="502" r="52" fill="url(#lx-door)" class="la-pulse"/><path d="M332,520v-28h28v28z" fill="#0b1413"/><path d="M325,524v-38h7v38zM360,524v-38h7v38zM320,488h52v-9h-52z" fill="#3b4440"/>`;
  [[292, 546, 12, 28], [318, 556, 11, 24], [394, 560, 13, 30], [436, 556, 12, 26], [266, 536, 10, 22], [464, 544, 11, 24], [356, 564, 13, 27]].forEach(([x, y, w, h]) => { s += `<path d="M${x},${y}v-${h}q${w / 2},-6 ${w},0v${h}z" fill="#353d3a"/><path d="M${x + w},${y - h}v${h}" stroke="#7fd6d0" stroke-opacity="0.2"/>`; });
  // Cinderwing, breathing fire as it sweeps over
  s += `<circle cx="300" cy="250" r="140" fill="url(#lx-glow)" class="la-fire"/>`;
  s += `<g transform="translate(470 222) scale(-1.2 1.2)">${laDragon()}</g>`;
  // snow over the north, rain over the south
  let snow = '', rain = '';
  for (let k = -1; k <= 2; k++) for (let i = 0; i < 26; i++) { const x = (i * 37.3) % 330 - 20 - k * 36, y = (i * 71.7) % 300 + k * 300; snow += `<circle cx="${fx1(x)}" cy="${fx1(y)}" r="${fx1(1 + (i % 3) * 0.6)}"/>`; }
  for (let k = -1; k <= 4; k++) for (let i = 0; i < 26; i++) { const x = 560 + (i * 53.1) % 300 - k * 40, y = (i * 47.3) % 160 + k * 160; rain += `<path d="M${fx1(x)},${fx1(y)}l-6,22"/>`; }
  s += `<g fill="#f2f6ff" opacity="0.8" class="la-snow">${snow}</g><g stroke="#aebfd4" stroke-width="1.1" stroke-opacity="0.45" class="la-rain">${rain}</g>`;
  s += `<path d="M0,570C140,556 300,572 440,564C600,556 700,570 800,564V600H0Z" fill="#090c0d"/>`;
  for (let i = 0; i < 50; i++) { const gx = r() * 800, gy2 = 586 + r() * 14; s += `<path d="M${fx1(gx)},${fx1(gy2 + 12)}q${fx1((r() - 0.3) * 6)},${fx1(-10 - r() * 12)} ${fx1((r() - 0.5) * 8)},${fx1(-14 - r() * 14)}" stroke="#060808" stroke-width="2" fill="none"/>`; }
  return s;
}
// the dragon in profile, facing right, about 330 across: far wing, body, near wing, fire
function laDragon() {
  const wing = 'M20,-16L-8,-62L12,-112Q-46,-150 -150,-152Q-116,-116 -160,-82Q-110,-72 -122,-32Q-84,-36 -62,-10Q-40,-20 -22,-8Z';
  const bones = 'M20,-16L-8,-62L12,-112M12,-112L-150,-152M12,-112L-160,-82M12,-112L-122,-32M12,-112L-62,-10';
  return `<g transform="translate(30 -6) rotate(-10) scale(0.88)"><path d="${wing}" fill="#1c0d0b"/><path d="${bones}" stroke="#0a0505" stroke-width="2.6" fill="none" stroke-linejoin="round"/></g>`
    + '<path d="M-180,12C-150,6 -118,-4 -84,-6C-58,-8 -36,-16 -8,-18C14,-20 30,-22 44,-28C56,-34 64,-48 74,-58C82,-66 92,-70 102,-68L124,-64L130,-58L116,-54L126,-44L104,-44C94,-38 84,-26 74,-12C62,4 42,16 16,18C-12,20 -44,16 -74,10C-104,8 -140,14 -180,16Z" fill="#170b0a"/>'
    + '<path d="M-178,14L-197,4L-191,15L-197,26Z" fill="#170b0a"/><path d="M100,-68L90,-85L104,-72ZM92,-66L79,-79L96,-68Z" fill="#2c1510"/>'
    + '<path d="M34,14C38,28 44,34 54,36L56,31C48,29 46,22 46,14ZM-44,12C-42,26 -34,34 -22,37L-18,32C-28,30 -32,22 -30,12Z" fill="#170b0a"/>'
    + '<path d="M16,18C42,16 62,4 74,-12C84,-26 94,-38 104,-44" fill="none" stroke="#ff8a3a" stroke-opacity="0.6" stroke-width="2.5"/>'
    + `<path d="${wing}" fill="url(#lx-wing)"/><path d="${bones}" stroke="#0c0606" stroke-width="2.6" fill="none" stroke-linejoin="round"/>`
    + '<path d="M122,-50L304,8Q326,46 294,72L118,-42Z" fill="url(#lx-fire)" class="la-fire"/>';
}
// V. your road at dawn: your town, the portal stones and the way to the pass
function laRoad(R, cls) {
  const r = mulberry(59);
  let s = `<defs>
    <linearGradient id="lr-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#131a30"/><stop offset="0.3" stop-color="#363c62"/><stop offset="0.48" stop-color="#86677c"/><stop offset="0.58" stop-color="#e2a274"/><stop offset="0.64" stop-color="#f8d49c"/></linearGradient>
    <radialGradient id="lr-sun" cx="0.5" cy="0.56" r="0.5"><stop offset="0" stop-color="#fff2c8" stop-opacity="1"/><stop offset="0.16" stop-color="#ffd090" stop-opacity="0.55"/><stop offset="1" stop-color="#ffb070" stop-opacity="0"/></radialGradient>
    <linearGradient id="lr-beam" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#8fe0ff" stop-opacity="0.65"/><stop offset="1" stop-color="#8fe0ff" stop-opacity="0"/></linearGradient>
    <radialGradient id="lr-portal"><stop offset="0" stop-color="#e8fbff"/><stop offset="0.4" stop-color="#6fd0ff" stop-opacity="0.75"/><stop offset="1" stop-color="#3a8ad0" stop-opacity="0"/></radialGradient>
    <radialGradient id="lr-win"><stop offset="0" stop-color="#ffd27a" stop-opacity="0.9"/><stop offset="1" stop-color="#ffb04a" stop-opacity="0"/></radialGradient>
    <radialGradient id="lr-orb"><stop offset="0" stop-color="#cfe9ff" stop-opacity="0.8"/><stop offset="1" stop-color="#6fb0ff" stop-opacity="0"/></radialGradient>
    <linearGradient id="lr-haze" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f0b886" stop-opacity="0"/><stop offset="1" stop-color="#e6a884" stop-opacity="0.5"/></linearGradient>
  </defs><rect width="800" height="600" fill="url(#lr-sky)"/><rect width="800" height="600" fill="url(#lr-sun)"/>`;
  s += laStars(r, 40, 140, 0.6);
  // the far mountains, the pass in the middle, and the Lone Tree beyond it
  const far = laRidge({ seed: 5.5, y: 372, amp: 170, freq: 0.009, sharp: true, notch: [[400, 52, 340]] });
  s += `<path d="${laArea(far)}" fill="#4b4a6e"/><path d="${laSnowcap(far, 270, 26, 3)}" fill="#f0d6c4" opacity="0.75"/>`;
  s += laTree(400, 342, 26, 5, { bark: '#3a3654', leaf: '#3a3654', depth: 4 });
  s += `<rect y="300" width="800" height="110" fill="url(#lr-haze)"/>`;
  const mid = laRidge({ seed: 8.1, y: 430, amp: 70, freq: 0.006, notch: [[400, 60, 372]] });
  s += `<path d="${laArea(mid)}" fill="#3a3a52"/>`;
  const near = laRidge({ seed: 13.9, y: 488, amp: 60, freq: 0.0055 });
  s += `<path d="${laArea(near)}" fill="#26303a"/>`;
  // the town: roofs, lit windows, smoke
  let town = '', win = '', smoke = '';
  for (let i = 0; i < 8; i++) {
    const x = 40 + i * 30 + r() * 10, gy = 452 + Math.abs(i - 3.5) * 5 + r() * 4, w = 22 + r() * 10, h = 14 + r() * 8, rf = 12 + r() * 8;
    town += `<path d="M${fx1(x)},${fx1(gy)}v${fx1(-h)}l${fx1(w / 2)},${fx1(-rf)}l${fx1(w / 2)},${fx1(rf)}v${fx1(h)}z"/>`;
    if (r() < 0.8) win += `<rect x="${fx1(x + w * 0.3)}" y="${fx1(gy - h * 0.7)}" width="3.4" height="4.4" fill="#ffd27a"/><circle cx="${fx1(x + w * 0.3 + 1.7)}" cy="${fx1(gy - h * 0.55)}" r="9" fill="url(#lr-win)"/>`;
    if (i % 3 === 1) for (let j = 0; j < 3; j++) smoke += `<circle class="la-rise" style="animation-delay:${fx1(-j * 1.6 - i)}s" cx="${fx1(x + w * 0.7)}" cy="${fx1(gy - h - rf + 2)}" r="${fx1(5 + j * 2)}" fill="#c8b8b8" opacity="0.3"/>`;
  }
  s += `<g fill="#1a1f29">${town}</g>${win}${smoke}`;
  // the portal stones on their rise
  s += `<path d="M500,470q70,-30 150,0z" fill="#202a33"/>`;
  s += `<path d="M560,460L548,180H622L610,460Z" fill="url(#lr-beam)" class="la-pulse"/><ellipse cx="585" cy="458" rx="40" ry="9" fill="url(#lr-portal)"/>`;
  [[548, 462, 32], [566, 452, 28], [604, 452, 28], [622, 462, 32], [585, 450, 24]].forEach(([x, y, h]) => { s += `<path d="M${x - 4},${y}v-${h}l4,-3l4,3v${h}z" fill="#1c252d"/><path d="M${x},${y - h + 6}v${h - 12}" stroke="#8fe0ff" stroke-opacity="0.6" stroke-width="1.2"/>`; });
  // the road from your feet to the pass, and the steps of your path along it
  const road = [[392, 620], [372, 576], [446, 540], [470, 506], [404, 474], [384, 448], [418, 420], [404, 394], [400, 372]];
  s += `<path d="M${laP(road)}" fill="none" stroke="#2a2a33" stroke-width="44" stroke-linecap="round" stroke-linejoin="round" opacity="0.5"/>`;
  s += `<path d="M${laP(road)}" fill="none" stroke="#c9a37a" stroke-width="20" stroke-linecap="round" stroke-linejoin="round" opacity="0.32"/>`;
  road.slice(1, -1).forEach(([x, y], i) => { s += `<circle cx="${x}" cy="${y}" r="${fx1(5 - i * 0.45)}" fill="#ffd88a" opacity="${fx1(0.95 - i * 0.07)}" class="la-pulse" style="animation-delay:${fx1(-i * 0.35)}s"/><circle cx="${x}" cy="${y}" r="${fx1(16 - i * 1.4)}" fill="#ffd88a" opacity="0.12"/>`; });
  s += `<path d="M0,560C140,540 260,556 340,600L0,620Z" fill="#141a20"/><path d="M800,540C690,540 560,566 470,610L800,620Z" fill="#141a20"/>`;
  for (let i = 0; i < 40; i++) { const gx = r() * 800, gy2 = 592 + r() * 10; s += `<path d="M${fx1(gx)},${fx1(gy2 + 12)}q${fx1((r() - 0.3) * 6)},${fx1(-10 - r() * 12)} ${fx1((r() - 0.5) * 8)},${fx1(-14 - r() * 14)}" stroke="#0b0f13" stroke-width="2" fill="none"/>`; }
  // you
  s += laHero(300, 596, 166, cls, laShade(R.color, 0.46), '#ffd9a0', '#b9b2a6');
  return s;
}

/* ------------------------------------------------------------------ */
/* the prologue                                                        */
/* ------------------------------------------------------------------ */
function prologuePages() {
  const P = GAME.player, prog = GAME.prog, R = REALMS[P.faction], C = CLASSES[P.cls];
  const vet = prog.level >= 10;
  return [
    { k: 'I · The March', t: 'The Hallowmarch', art: 'march', p: [
      'At the heart of the world rises a green hill, and on the hill stands a single tree older than any kingdom. Around it lies the Hallowmarch: open downs, old roads and broken walls, ringed by mountains with three passes through them.',
      'Beyond each pass lies a realm. <b>Logres</b>, of stone keeps and wheat fields. <b>Ériu</b>, of green glens and standing stones. <b>Thule</b>, of pine forests and long winters. Each calls the March its birthright, and none of them will share it.',
    ] },
    { k: 'II · The Hallows', t: 'The Three Hallows', art: 'hallows', p: [
      'Long ago one king ruled the whole March from a hall beneath the hill. He gathered three hallows, <b>the Grail</b>, the stone <b>Lia Fáil</b> and the ring <b>Draupnir</b>, and tried to bind their power to himself so that he would never die.',
      'His three captains would not let him. They carried the hallows away through the passes, sealed the king and his court in his barrow, and each founded a realm of their own. Under the Lone Tree they swore to share the March in peace, and the oath held for a hundred years.',
      'Then came a winter that would not end, and each realm crossed the passes to take what the others had. The war has not stopped since.',
    ] },
    { k: 'III · The War', t: 'Keeps and Gates', art: 'war', p: [
      'Each realm guards its side of the March with two keeps and the temple that holds its hallow. Warbands gather at the muster by the portal stones and march wherever their commander sends them.',
      'To take a keep, break its gate (or bring its walls down with siege engines and storm the breach) and slay its lord. A temple cannot be harmed while its realm holds both of its keeps, but once one falls the temple lies open: break its gate, take the hallow and carry it home. Every foreign hallow in your temple makes each soldier of your realm strike a tenth harder.',
      'Gates are rebuilt and keeps are taken back, and a dropped hallow finds its way home. The war is a tide, and every soldier moves it.',
    ] },
    { k: 'IV · The Wilds', t: 'Older Than the War', art: 'wilds', p: [
      '<b>Cinderwing</b>, a great red dragon, circles above the March and comes down to rest on high ground. It is a fight for the strong, or for many.',
      'East of the Lone Tree stands the old king\'s barrow. He got his wish: he never died. The <b>Hollow King</b> waits on his throne at its far end, with his court of the dead and the richest hoard in the land.',
      'Beasts, outlaws and the restless dead roam the wilds of every realm, led on the borderlands by named champions. And over all of it the weather turns: rain and mist, snow in the north and on the passes, and storms that shake the sky.',
    ] },
    { k: 'V · Your Road', t: 'Your Road', art: 'road', p: [
      `You are <b>${esc(P.name)}</b>, ${loreAn(C.name)} ${C.name.toLowerCase()} of ${R.name}. ${vet ? `You come to ${R.townName} a veteran, ready for the frontier.` : `You begin in ${R.townName} as a recruit.`}`,
      `Speak with the herald in the square for bounties, buy healing draughts from ${R.merchant ? R.merchant.name : 'the merchant'}, and grow strong against the creatures of ${homeIn(R)}. At level 14, step through the portal stones to ${R.name} Muster on the frontier, join a warband, and help carry a hallow home to the ${R.templeName}.`,
      `Between fights the March feeds those who know it: eat and drink, cook what you hunt, fish, farm, tame beasts, craft at the workstations and build. <b>Your path</b>, at the ${IS_TOUCH ? 'top left' : 'left'} of the screen, shows your next step, and the gold gem on your minimap shows where. The whole story, and how everything works, is in the <b>Chronicle</b>${IS_TOUCH ? ', in the menu' : ' (J)'}.`, // [guide]
    ] },
  ];
}
function openPrologue(replay = false) {
  if (!GAME.player || !GAME.prog) return false;
  if (UI.modal === 'menu') closeMenu();
  if (UI.modal) return false;
  UI.modal = 'prologue';
  LORE.pro = { pages: prologuePages(), i: 0, replay };
  INPUT.keys.clear(); INPUT.joy = null; hideJoystick();
  let ov = $('lore-pro');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'lore-pro';
    document.body.appendChild(ov);
    ov.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-pro]');
      if (!b || !LORE.pro) return;
      const a = b.dataset.pro;
      if (a === 'skip') closePrologue();
      else if (a === 'next') prologueGo(1);
      else if (a === 'back') prologueGo(-1);
      else prologueGo(+a - LORE.pro.i);
    });
    // a swipe on the page turns it
    ov.addEventListener('pointerdown', (e) => { if (!e.target.closest('button')) LORE.swipe = { x: e.clientX, y: e.clientY }; });
    ov.addEventListener('pointerup', (e) => {
      const w = LORE.swipe;
      LORE.swipe = null;
      if (!w || !LORE.pro) return;
      const dx = e.clientX - w.x, dy = e.clientY - w.y;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) prologueGo(dx < 0 ? 1 : -1);
    });
  }
  ov.hidden = false;
  renderPrologue();
  return true;
}
function renderPrologue() {
  const S = LORE.pro, ov = $('lore-pro');
  if (!S || !ov) return;
  const pg = S.pages[S.i], last = S.i === S.pages.length - 1, P = GAME.player;
  ov.innerHTML = `<div class="book" role="dialog" aria-modal="true" aria-labelledby="lore-pro-t" aria-describedby="lore-pro-x">
    <div class="art">${loreArt(pg.art, P.faction, P.cls)}</div>
    <div class="leaf">
      <div class="head"><span class="kicker">${pg.k}</span><button type="button" class="skip" data-pro="skip">${S.replay ? 'Close' : 'Skip the prologue'}</button></div>
      <h2 id="lore-pro-t">${pg.t}</h2>
      <div class="text" id="lore-pro-x">${pg.p.map((p) => `<p>${p}</p>`).join('')}</div>
      <div class="foot"><div class="dots">${S.pages.map((q, i) => `<button type="button" data-pro="${i}" aria-label="Page ${i + 1}: ${q.t}" aria-current="${i === S.i}"></button>`).join('')}</div>
        ${S.i > 0 ? '<button class="btn" type="button" data-pro="back">Back</button>' : ''}<button class="btn primary" type="button" data-pro="next">${last ? (S.replay ? 'Return to the march' : 'Begin') : 'Next'}</button></div>
    </div></div>`;
  if (!IS_TOUCH) { const nx = ov.querySelector('[data-pro="next"]'); if (nx) nx.focus({ preventScroll: true }); }
  const tx = ov.querySelector('.text');
  const more = () => tx.classList.toggle('more', tx.scrollHeight - tx.scrollTop - tx.clientHeight > 6);
  tx.addEventListener('scroll', more, { passive: true });
  requestAnimationFrame(more);
}
function prologueGo(d) {
  const S = LORE.pro;
  if (!S) return;
  const i = S.i + d;
  if (i >= S.pages.length) { closePrologue(); return; }
  if (i < 0 || i === S.i) return;
  S.i = i;
  renderPrologue();
  sfx('click');
}
function closePrologue() {
  const S = LORE.pro;
  const ov = $('lore-pro');
  if (ov) { ov.hidden = true; ov.innerHTML = ''; }
  LORE.pro = null;
  if (UI.modal === 'prologue') UI.modal = null;
  if (GAME.prog && GAME.prog.lore) { GAME.prog.lore.pro = 1; saveSoon(); }
  if (S && !S.replay) loreNote('start');
}
// the prologue's keys come first, and the game never sees them
window.addEventListener('keydown', (e) => {
  if (UI.modal !== 'prologue' || !LORE.pro) return;
  const k = e.code;
  const onBtn = !!(document.activeElement && document.activeElement.closest && document.activeElement.closest('#lore-pro button'));
  if (k === 'Escape') { e.preventDefault(); closePrologue(); }
  else if (k === 'ArrowRight' || k === 'PageDown') { e.preventDefault(); prologueGo(1); }
  else if (k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); prologueGo(-1); }
  else if ((k === 'Enter' || k === 'Space' || k === 'NumpadEnter') && !onBtn) { e.preventDefault(); prologueGo(1); }
  e.stopPropagation();
}, true);
// J opens the Chronicle
window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyJ' || e.repeat || !GAME.started || typing() || gameplayKeyIgnored(e)) return;
  if (UI.modal === 'menu' && UI.menuTab === 'chronicle') closeMenu();
  else if (!UI.modal) openChronicle(LORE.chronSec);
});

/* ------------------------------------------------------------------ */
/* the path on the HUD                                                 */
/* ------------------------------------------------------------------ */
function buildPathHud() {
  let el = $('lore-path');
  if (!el) {
    el = document.createElement('div');
    el.id = 'lore-path';
    el.className = 'panel';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Your path');
    $('hud').appendChild(el);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const a = b.dataset.act;
      if (a === 'open') { openChronicle('path'); return; }
      if (a === 'aims') { openChronicle('goals'); return; } // [guide]
      LORE.min = a === 'min';
      try { localStorage.setItem('hallowmarch.lore.min', LORE.min ? '1' : '0'); } catch (err) { /* storage may be blocked */ }
      LORE.hudKey = '';
      renderPathHud();
      sfx('click');
    });
  }
  if (LORE.min === null) {
    let v = null;
    try { v = localStorage.getItem('hallowmarch.lore.min'); } catch (err) { /* storage may be blocked */ }
    LORE.min = v === null ? (IS_TOUCH || window.innerHeight < 520) : v === '1';
  }
  LORE.hudKey = '';
  LORE.top = -1;
  LORE.placeT = 0.25;
  renderPathHud();
  placePathHud();
}
function renderPathHud() {
  const el = $('lore-path'), P = GAME.player, prog = GAME.prog;
  if (!el || !P || !prog || !prog.lore) return;
  const R = REALMS[P.faction], S = pathNext(), n = prog.lore.done.length, N = PATH_STEPS.length;
  let html;
  if (!S) {
    // [guide] the path walked: what to aim for now (the Chronicle's Aims page has the rest)
    const A = guideAims()[0];
    html = LORE.min
      ? `<div class="ph"><span class="gem"></span><button type="button" class="st" data-act="aims" title="Open your aims in the Chronicle">${A ? esc(A.t) : 'Your path is walked'}</button><span class="n">${N}/${N}</span><button type="button" class="tog" data-act="max" aria-label="Show your aims">${iconSvg('lplus', 12)}</button></div>`
      : `<div class="ph"><span class="lbl">Your aims</span><span class="n">${N} / ${N}</span><button type="button" class="tog" data-act="min" aria-label="Fold your aims away">${iconSvg('lminus', 12)}</button></div><button type="button" class="step" data-act="aims"><span class="gem"></span><span class="st">${A ? esc(A.t) : 'Every step is walked'}</span><span class="hint">${A && A.x ? A.x : 'Every step of your path is walked. The March is yours to shape.'}</span>${A && A.m ? `<span class="meter"><i><b style="width:${(clamp(A.m[0], 0, 1) * 100).toFixed(1)}%"></b></i>${A.m[1]}</span>` : ''}</button>`;
  } else if (LORE.min) {
    const w = guideShortWhere(); // [guide] how far, at a glance
    html = `<div class="ph"><span class="gem"></span><button type="button" class="st" data-act="open" title="${S.title}: open your path in the Chronicle${IS_TOUCH ? '' : ' (J)'}" aria-label="Next step: ${S.title}${w ? ', ' + w : ''}">${S.short}${w ? `<span class="gd-d">${w}</span>` : ''}</button><span class="n">${n}/${N}</span><button type="button" class="tog" data-act="max" aria-label="Show the next step in full">${iconSvg('lplus', 12)}</button></div>`;
  } else {
    const m = S.level ? [loreLvlFrac(prog, S.level), `Level ${prog.level} of ${S.level}`] : S.meter ? S.meter(prog) : null;
    const rw = rewardLabel(S, prog);
    html = `<div class="ph"><span class="lbl">Your path</span><span class="n">${n} / ${N}</span><button type="button" class="tog" data-act="min" aria-label="Fold your path away">${iconSvg('lminus', 12)}</button></div>`
      + `<button type="button" class="step" data-act="open" title="Open your path in the Chronicle${IS_TOUCH ? '' : ' (J)'}"><span class="gem"></span><span class="st">${S.title}</span><span class="hint">${S.hint(R, prog)}</span>`
      + (m ? `<span class="meter"><i><b style="width:${(m[0] * 100).toFixed(1)}%"></b></i>${m[1]}</span>` : '')
      + guideWhereLine() /* [guide] how far and which way: the gold gem on the minimap (10e_guide.js) */ + g2PointerLine() /* [guide2] or the button that does it (10f_guide2.js) */
      + `<span class="rw">${iconSvg(rw.ic, 14)}Reward: ${rw.t}</span></button>` + water2PathLine(); // [water2] diving and boats, when they are at hand (07e_boats.js)
  }
  if (html !== LORE.hudKey) { el.innerHTML = html; LORE.hudKey = html; }
  el.classList.toggle('min', !!LORE.min);
}
// sit just under the player frame, whatever its height
function placePathHud() {
  const el = $('lore-path'), pf = $('pf');
  if (!el || !pf) return;
  const top = Math.round(pf.getBoundingClientRect().bottom + 8);
  if (top > 0 && top !== LORE.top) { el.style.top = top + 'px'; LORE.top = top; }
}
function openChronicle(sec) {
  if ((sec || LORE.chronSec) === 'coach') {
    if (LORE.chronSec === 'coach') LORE.chronSec = 'path';
    openMenu('progress'); return;
  }
  if (sec) LORE.chronSec = sec;
  if (UI.modal === 'menu') renderMenu('chronicle');
  else openMenu('chronicle');
}

/* ------------------------------------------------------------------ */
/* watching the world for steps taken and things seen                  */
/* ------------------------------------------------------------------ */
function loreWatch() {
  const P = GAME.player, prog = GAME.prog, R = REALMS[P.faction], ev = LORE.ev;
  // a bounty paid out by the herald
  const b = prog.bounty;
  if (LORE.bounty && LORE.bounty.done && b !== LORE.bounty) ev.bounty = true;
  LORE.bounty = b;
  // a draught bought at a stall
  if (INV.potions > LORE.potions && UI.modal === 'kit' && UI.kitMode === 'shop') ev.draught = true;
  LORE.potions = INV.potions;
  // the herald's dialog open beside him
  if (UI.modal === 'dialog' && R.herald && dist2(P.x, P.z, R.herald.x, R.herald.z) < 49 && $('dlg-title').textContent === R.herald.name) ev.herald = true;
  // a hallow carried all the way home
  if (P.carrying != null) LORE.carried = WAR.relics[P.carrying] || null;
  else if (LORE.carried) { const rel = LORE.carried; LORE.carried = null; if (rel.state === 'temple' && rel.at === P.faction) ev.hallow = true; }
  // enemy gates that break with you there
  for (const D of [...WAR.keeps.map((K) => K.door), ...WAR.temples.map((T) => T.door)]) {
    if (LORE.doors.get(D.id) && !D.alive && D.faction !== P.faction) {
      const d = dist(P.x, P.z, D.x, D.z);
      if (d < 50 || (D.damagers && D.damagers.has(P.id) && d < 120)) ev.gate = true;
    }
    LORE.doors.set(D.id, D.alive);
  }
  // champions of the borderlands that fall to you
  for (const e of LORE.elites) if (!e.alive) { if (e.damagers && e.damagers.has(P.id)) ev.champion = true; LORE.elites.delete(e); }
  for (const c of CAMPS) if (c.elite) { const e = getEnt(c.eliteId); if (e && e.alive && dist2(P.x, P.z, e.x, e.z) < 90 * 90) LORE.elites.add(e); }
  // loot picked up from the ground
  if (!prog.lore.seen.includes('loot')) {
    for (const L of LORE.loot) if (!LOOT.includes(L) && dist2(P.x, P.z, L.x, L.z) < 9) ev.loot = true;
    LORE.loot = new Set(LOOT);
  }
  // states that complete a step the moment they are true
  if (P.alive) {
    if (prog.level >= 14 && dist2(P.x, P.z, R.musterSite.x, R.musterSite.z) < (R.musterSite.r + 8) ** 2) ev.muster = true;
    if (inDungeon(P)) ev.barrow = true;
    if ((prog.kingKills || 0) > 0) ev.king = true;
    if (GAME.t < P.combatUntil && WAR.warbands.some((wb) => wb.realm === P.faction && wbMembers(wb).some((m) => GAME.t < m.combatUntil && dist2(m.x, m.z, P.x, P.z) < 28 * 28))) ev.warband = true;
  }
  for (const S of PATH_STEPS) if (S.level && prog.level >= S.level) ev[S.id] = true;
  // [guide] the steps of version 13: a meal cooked and a thing made (09t_craft.js tells guideMade), a tower's top, an
  // order given, a keep taken with you there, the realm's gift called, Cinderwing brought down, a masterwork made, a
  // campaign won
  for (const k of GUIDE.made.splice(0)) ev[k] = true;
  if (P.alive) { const T = towerRoomOf(P); if (T && T.top) ev.climb = true; }
  if (WAR.warbands.some((wb) => wb.realm === P.faction && !wb.dead && wb.order && wb.order.byPlayer)) ev.command = true;
  const kr = WAR.keeps.map((K) => K.realm);
  if (LORE.keepRealm) WAR.keeps.forEach((K, i) => { if (K.realm === P.faction && LORE.keepRealm[i] !== P.faction && dist2(P.x, P.z, K.site.x, K.site.z) < 90 * 90) ev.keep = true; });
  LORE.keepRealm = kr;
  if (GIFT.lastCast && GIFT.lastCast.by === P.id) ev.gift = true;
  const Dg = DRAGON.e;
  // [guide2] brought down by you: your share of the harm it took (its threat holds every blow) a twentieth of its health
  // or more, or the last blow, and you near when it fell (a single arrow and a fall 200 m off counted)
  if (Dg) {
    if (Dg.alive && !Dg.removed) { const th = Dg.threat && Dg.threat.get(P.id); if (th) LORE.dragonHit = Math.max(LORE.dragonHit || 0, th / Math.max(1, Dg.maxHp)); if (Dg.lastHitBy === P.id) LORE.dragonLast = GAME.t; }
    else if (LORE.dragonHit) { if (dist2(P.x, P.z, Dg.x, Dg.z) < 120 * 120 && (LORE.dragonHit >= 0.05 || Dg.lastHitBy === P.id || GAME.t - (LORE.dragonLast || -99) < 3)) ev.dragon = true; LORE.dragonHit = 0; }
  }
  if (!LORE.mwNames) LORE.mwNames = new Set(RECIPES.filter((r) => r.mw).map((r) => r.mw));
  if (!pathDone('master') && kitItems().some((it) => LORE.mwNames.has(it.name))) ev.master = true;
  const H = CAMPAIGN.history, hl = H.length ? H[H.length - 1] : null;
  if (LORE.campN != null && hl && hl.n !== LORE.campN && hl.w === P.faction && hl.you) ev.campaign = true;
  LORE.campN = hl ? hl.n : 0;
  // only once no window is open: then one finished step at a time
  if (!UI.modal) {
    const S = PATH_STEPS.find((q) => ev[q.id] && !prog.lore.done.includes(q.id));
    if (S) pathComplete(S);
  }
  // first-time notes
  const seen = prog.lore.seen;
  const want = (id, cond) => { if (!seen.includes(id) && !LORE.queue.includes(id) && cond()) LORE.queue.push(id); };
  if (P.alive) {
    const out = !inDungeon(P);
    want('frontier', () => out && Math.hypot(P.x, P.z) < R_RING - 8);
    want('keep', () => out && WAR.keeps.some((K) => K.realm !== P.faction && dist2(P.x, P.z, K.site.x, K.site.z) < 75 * 75));
    want('mount', () => !!P.mount);
    want('loot', () => !!ev.loot);
    want('barrow', () => !out);
    want('rain', () => out && WEATHER.raining > 0.45 && WEATHER.snowing < 0.15);
    want('snow', () => out && WEATHER.snowing > 0.35);
    want('dragon', () => { const D = DRAGON.e; return out && !!D && D.alive && !D.removed && dist2(P.x, P.z, D.x, D.z) < 140 * 140; });
    want('lowhp', () => P.hp < P.maxHp * 0.35 && GAME.t < P.combatUntil && INV.potions > 0);
    want('carry', () => P.carrying != null);
    // [campaign] (08g_campaign.js)
    want('command', () => out && cwCanCommand() && Math.hypot(P.x, P.z) < R_RING + 40);
    want('claim', () => CAMPAIGN.claims.some((c) => c.kOn || c.hOn));
    want('campaign', () => CWUI.vicShown && UI.modal !== 'victory');
    guideWatch(want); // [guide] the notes of every system since (10e_guide.js)
  }
}
// a field note in the banner lane; returns whether it was shown
function loreNote(id) {
  const prog = GAME.prog, N = FIELD_NOTES[id];
  if (!prog || !prog.lore || !N || prog.lore.seen.includes(id)) return false;
  if (!LORE.queue.includes(id)) LORE.queue.push(id);
  return true;
}
function showNextNote(announce = !IS_TOUCH) {
  const prog = GAME.prog, P = GAME.player;
  const qi = guideNoteIndex(); // [guide] first steps first, not over a fight, only where it means something
  if (qi < 0) return;
  const id = LORE.queue.splice(qi, 1)[0];
  GUIDE.stats.notesShown++;
  const N = FIELD_NOTES[id];
  if (!N || prog.lore.seen.includes(id)) return;
  prog.lore.seen.push(id);
  // Touch players collect the same notes without interrupting the world.
  // The Notes destination reads the complete, saved text on demand.
  if (!announce) { saveSoon(); return; }
  const R = REALMS[P.faction], text = N.x(R);
  const host = $('banners');
  const d = document.createElement('div');
  d.className = 'banner panel lore-note';
  d.setAttribute('role', 'status');
  d.title = 'Click to dismiss';
  d.innerHTML = `<small>Field note</small><b>${N.t}</b><span>${text}</span>`;
  d.addEventListener('click', () => { const small = $('banners').classList.contains('hl-compact') || $('banners').classList.contains('hl-brief'); /* [look6] its first lines only: a tap reads it whole */ d.remove(); if (small && !UI.modal) { G2.noteFocus = id; openChronicle('notes'); } }); // [guide] shrunk to its title on a small screen: a tap reads it in the Chronicle ([guide2] on the field notes' page, itself first and open)
  host.appendChild(d);
  setTimeout(() => d.remove(), 11000);
  while (host.childNodes.length > 3) host.removeChild(host.firstChild);
  uiLog(`${N.t}: ${text}`, 'sys');
  LORE.noteUntil = performance.now() + 11500;
  HUDL.k = 0; // [guide] laid out this frame: it never lies over a panel, even for a moment
  saveSoon();
}
// the death sheet carries a word of advice
function deathNote() {
  const prog = GAME.prog, P = GAME.player;
  let el = $('lore-dnote');
  if (!el) {
    el = document.createElement('p');
    el.id = 'lore-dnote';
    el.className = 'lore-dnote';
    const sheet = $('death').querySelector('.sheet');
    sheet.insertBefore(el, $('btn-release'));
  }
  if (!prog.lore.seen.includes('death')) {
    prog.lore.seen.push('death');
    el.innerHTML = `<b>Field note</b>${FIELD_NOTES.death.x(REALMS[P.faction])}`;
    saveSoon();
  } else el.innerHTML = `<b>From the Chronicle</b>${pick(Math.random, LOADING_TIPS)}`;
}

/* ------------------------------------------------------------------ */
/* the Chronicle                                                       */
/* ------------------------------------------------------------------ */
const CHRON_SECTIONS = [['march', 'The March'], ['realms', 'Realms'], ['callings', 'Callings'], ['gifts', 'Realm gifts'], ['war', 'The war'], ['orders', 'Orders'], ['halls', 'Keep halls'], ['wilds', 'Creatures'], ['dragon', 'Cinderwing'], ['barrow', 'The Barrow'], ['water', 'Water'], ['living', 'Living off the land'], ['fields', 'Fields'], ['herbal', 'Herbal'], ['animals', 'Animals'], ['building', 'Building'], ['path', 'Your path']]; // [gifts] chronGifts in 06c_gifts.js; [classes] chronClasses in 10d_classes_ui.js; [water] chronWater in 07b_swim.js; [survival] chronLiving in 09s_survival.js; [farming] chronFields, chronHerbal in 08h_farming.js; [animals] chronAnimals in 08h_animals.js; [building] chronHalls, chronBuilding in 06k_build.js
function renderChronicle(body, fromNav = false) {
  if (LORE.chronSec === 'coach') { LORE.chronSec = 'path'; renderMenu('progress'); return; }
  if (!CHRON_SECTIONS.some(([k]) => k === LORE.chronSec)) LORE.chronSec = 'march';
  const sec = LORE.chronSec;
  const fn = { march: chronMarch, realms: chronRealms, callings: chronClasses, gifts: chronGifts, war: chronWar, orders: chronOrders, halls: chronHalls, wilds: chronWilds, dragon: chronDragon, barrow: chronBarrow, water: chronWater, living: chronLiving, fields: chronFields, herbal: chronHerbal, animals: chronAnimals, building: chronBuilding, path: chronPath, ...CHRON_FN }[sec]; // [guide] CHRON_FN: pages added with chronAdd
  const G = chronGroupOf(sec), label = Object.fromEntries(CHRON_SECTIONS);
  // two rows: the four parts of the Chronicle, then the pages of the part you are in (every page is in the row; the
  // other parts' pages are hidden until you turn to them)
  const grps = CHRON_GROUPS.map(([gk, gl]) => `<button type="button" data-grp="${gk}" aria-current="${gk === G[0]}">${gl}</button>`).join('');
  const secs = CHRON_GROUPS.flatMap(([gk, , ks]) => ks.filter((k) => label[k]).map((k) => `<button type="button" data-sec="${k}" aria-current="${k === sec}"${gk === G[0] ? '' : ' hidden'}>${label[k]}</button>`)).join('');
  body.innerHTML = `<div class="chron"><nav class="chron-nav" aria-label="Chronicle"><div class="chron-grps">${grps}</div><div class="chron-secs">${secs}</div></nav><div class="chron-body">${fn()}</div></div>`;
  chronFold(sec); // [guide2] a long page folds into its summaries on a phone (10f_guide2.js)
  const sheet = body.closest('.sheet');
  const nav = body.querySelector('.chron-nav'), row = nav.querySelector('.chron-secs'), cur = row.querySelector('[aria-current="true"]');
  if (sheet && !fromNav) sheet.scrollTop = 0;
  else if (sheet) {
    const d = body.querySelector('.chron-body').getBoundingClientRect().top - sheet.getBoundingClientRect().top - nav.offsetHeight - 6;
    if (d < 0) sheet.scrollTop += d;
  }
  if (cur && row.scrollWidth > row.clientWidth) row.scrollLeft = cur.offsetLeft - row.clientWidth / 2 + cur.offsetWidth / 2;
  const grow = nav.querySelector('.chron-grps'), gcur = grow.querySelector('[aria-current="true"]');
  if (gcur && grow.scrollWidth > grow.clientWidth) grow.scrollLeft = gcur.offsetLeft - grow.clientWidth / 2 + gcur.offsetWidth / 2;
}
// the Chronicle's four parts; a page no part names falls under the first
const CHRON_GROUPS = [
  ['land', 'The March', ['march', 'realms', 'water', 'wilds', 'dragon', 'barrow']],
  ['you', 'Your path', ['path', 'callings']],
  ['war', 'The war', ['war', 'orders', 'halls', 'gifts']],
  ['life', 'Living', ['living', 'fields', 'herbal', 'animals', 'building']],
];
for (const [k] of CHRON_SECTIONS) if (!CHRON_GROUPS.some((g) => g[2].includes(k))) CHRON_GROUPS[0][2].push(k);
// [guide] a page from any module: its key, its label, the part it belongs to ('land', 'you', 'war', 'life'), the function
// that writes it, and the page it follows in that part (10e_guide.js adds Aims, Gear and Sieges)
const CHRON_FN = {};
function chronAdd(key, label, group, fn, after = null) {
  if (CHRON_FN[key] || CHRON_SECTIONS.some(([k]) => k === key)) return;
  CHRON_FN[key] = fn;
  CHRON_SECTIONS.push([key, label]);
  const G = CHRON_GROUPS.find((g) => g[0] === group) || CHRON_GROUPS[0];
  const i = after ? G[2].indexOf(after) : -1;
  if (i >= 0) G[2].splice(i + 1, 0, key); else G[2].push(key);
}
const chronGroupOf = (k) => CHRON_GROUPS.find((g) => g[2].includes(k)) || CHRON_GROUPS[0];
const chronLink = (k, label) => `<button type="button" class="btn" data-lore="sec:${k}">${label}</button>`; // [guide]
$('menu-body').addEventListener('click', (e) => {
  const s = e.target.closest('.chron-nav [data-sec]');
  if (s) {
    if (s.dataset.sec === 'coach') openChronicle('coach');
    else { LORE.chronSec = s.dataset.sec; renderChronicle($('menu-body'), true); }
    sfx('click'); return;
  }
  const g = e.target.closest('.chron-nav [data-grp]');
  if (g) { const G = CHRON_GROUPS.find((q) => q[0] === g.dataset.grp); if (G && chronGroupOf(LORE.chronSec) !== G) { LORE.chronSec = G[2][0]; renderChronicle($('menu-body'), true); sfx('click'); } return; }
  const a = e.target.closest('[data-lore]');
  if (a && a.dataset.lore === 'prologue') openPrologue(true);
  else if (a && a.dataset.lore.startsWith('sec:')) { openChronicle(a.dataset.lore.slice(4)); sfx('click'); } // [guide] a page's link to another (chronLink)
});

function chronMarch() {
  const P = GAME.player, here = inDungeon(P) ? 'the Hollow Barrow' : zoneAt(P.x, P.z).name;
  return `<p class="lead">At the heart of the world rises a green hill, and on the hill stands a single tree older than any kingdom. Around it lies the Hallowmarch, ringed by mountains with three passes through them, and beyond each pass lies a realm.</p>
    <p>Long ago one king ruled the whole March from a hall beneath the hill. He tried to bind the three hallows to himself so that he would never die, so his three captains carried them away, sealed him in his barrow and founded <b>Logres</b>, <b>Ériu</b> and <b>Thule</b>. They swore under the Lone Tree to share the March. A winter that would not end broke the oath, and the realms have fought over the March ever since.</p>
    <figure class="figure map">${marchMap()}<figcaption class="legend"><span>${chronGlyph('keep')}Keep, in its holder's colour</span><span>${chronGlyph('temple')}Temple of a hallow</span><span>${chronGlyph('muster')}Muster and portal stones</span><span>${chronGlyph('town')}Town</span><span>${chronGlyph('you')}You</span></figcaption></figure>
    <h3>The frontier</h3>
    <p>Inside the mountains lies the frontier, the land all three realms fight over. Each realm's road climbs through its own pass to its <b>muster</b>, where the warbands gather by the portal stones. Beyond the muster stands the realm's <b>temple</b>, which holds its hallow, and further in, its <b>two keeps</b>. At the centre the <b>Lone Tree</b> stands on its hill, with the <b>Hollow Barrow</b> just to the east.</p>
    <p>The ring of <b>portal stones</b> in every town carries you to your realm's muster and back in a moment. Each muster is guarded by wardens far stronger than any soldier, so no enemy takes it: it is always a safe place to gather, and where you rise again if you fall on the frontier.</p>
    <p>Outside the mountains, each realm's <b>homeland</b> is safe from the war but not from its wild creatures. You grow strong there before you go to the front.</p>
    <h3>Weather</h3>
    <p>The weather turns every few minutes: clear skies, overcast, rain, storms and mist. Logres sees the most fair days and Ériu the most mist and storms. Thule has the most rain, and there, and up on the passes, it falls as snow. Rain soaks the land, snow settles on the ground and the roofs and melts when the weather turns, and mist shortens how far you can see.</p>
    <p>The year turns as well, two days a season: blossom, harvest, bare boughs and snow lying where the air is cold. The <b>Fields</b> page tells how the seasons work on the land and the crops.</p>
    <p class="now">Now: <b>${WEATHER.label.toLowerCase()}</b> over ${here}, in ${SEASON.name.toLowerCase()}.</p>
    <div class="acts"><button type="button" class="btn" data-lore="prologue">Replay the prologue</button></div>`;
}
function chronGlyph(kind, col = '#d8cdb4') {
  const p = { keep: '<path d="M4 4h16v7c0 5-4 8-8 10-4-2-8-5-8-10z"/>', temple: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/>', muster: '<path d="M12 4l9 16H3z"/>', town: '<circle cx="12" cy="12" r="7"/>', you: '<path d="M12 3l7 18-7-5-7 5z"/>' }[kind];
  return `<svg viewBox="0 0 24 24" fill="${kind === 'you' ? '#fff' : col}" stroke="#0c0d10" stroke-width="1.5" aria-hidden="true">${p}</svg>`;
}
// a map-maker's mountain: a peak with a lit face and a snowy tip
function laPeak(x, y, h) {
  const w = h * 0.62;
  return `<path d="M${fx1(x - w)},${fx1(y + h * 0.42)}L${fx1(x)},${fx1(y - h * 0.58)}L${fx1(x + w)},${fx1(y + h * 0.42)}Z" fill="#4b4f57" stroke="#1a1c20" stroke-width="2" stroke-linejoin="round"/><path d="M${fx1(x)},${fx1(y - h * 0.58)}L${fx1(x + w)},${fx1(y + h * 0.42)}L${fx1(x + w * 0.2)},${fx1(y + h * 0.42)}Z" fill="#2e3137"/><path d="M${fx1(x - w * 0.3)},${fx1(y - h * 0.1)}L${fx1(x)},${fx1(y - h * 0.58)}L${fx1(x + w * 0.3)},${fx1(y - h * 0.1)}Z" fill="#dfe3ea" opacity="0.85"/>`;
}
// a map of the March drawn from the world itself: realms, passes, roads, sites and who holds them
function marchMap() {
  const P = GAME.player;
  const at = (R, along, lat) => rp(R, along, lat);
  let g = `<svg viewBox="-440 -440 880 880" role="img" aria-label="A map of the Hallowmarch">
    <defs><radialGradient id="lmm-bg"><stop offset="0" stop-color="#34402c"/><stop offset="0.6" stop-color="#222b1f"/><stop offset="1" stop-color="#131812"/></radialGradient></defs>
    <rect x="-440" y="-440" width="880" height="880" fill="#0e1014"/><circle r="436" fill="url(#lmm-bg)"/>`;
  for (const R of REALMS) {
    const a0 = R.bearing - 60 * DEG, a1 = R.bearing + 60 * DEG;
    g += `<path d="M0,0L${fx1(Math.sin(a0) * 436)},${fx1(-Math.cos(a0) * 436)}A436,436 0 0 1 ${fx1(Math.sin(a1) * 436)},${fx1(-Math.cos(a1) * 436)}Z" fill="${R.color}" opacity="0.16"/>`;
  }
  // the ring of mountains, broken by the three passes
  const order = REALMS.slice().sort((a, b) => a.bearing - b.bearing);
  order.forEach((R, i) => {
    const N = order[(i + 1) % 3];
    const a0 = R.bearing + 8 * DEG, a1 = N.bearing - 8 * DEG + (i === 2 ? TAU : 0);
    for (let a = a0; a <= a1 + 1e-6; a += (a1 - a0) / Math.max(1, Math.round((a1 - a0) / (5.2 * DEG)))) g += laPeak(Math.sin(a) * (R_RING + 6), -Math.cos(a) * (R_RING + 6), 17 + 6 * hash1(Math.round(a * 100)));
  });
  for (let a = 0; a < TAU; a += 4.2 * DEG) { const rr = 418 + 10 * hash1(Math.round(a * 77)); g += laPeak(Math.sin(a) * rr, -Math.cos(a) * rr, 15 + 7 * hash1(Math.round(a * 91))); }
  // roads
  for (const R of REALMS) {
    const pts = [[378, 0], [336, 12], [292, -4], [250, 0], [214, 0], [170, 0]].map(([a, l]) => at(R, a, l));
    g += `<path d="M${pts.map((p) => fx1(p.x) + ',' + fx1(p.z)).join('L')}" fill="none" stroke="#b39a6c" stroke-width="5" stroke-opacity="0.55" stroke-linejoin="round"/>`;
    for (const s of [1, -1]) { const k = [[194, 0], [190, 33 * s], [118, 40 * s], [118, 64 * s]].map(([a, l]) => at(R, a, l)); g += `<path d="M${k.map((p) => fx1(p.x) + ',' + fx1(p.z)).join('L')}" fill="none" stroke="#b39a6c" stroke-width="4" stroke-opacity="0.45" stroke-linejoin="round"/>`; }
  }
  g += `<circle r="72" fill="none" stroke="#b39a6c" stroke-width="4" stroke-opacity="0.4"/>`;
  // sites
  const glyph = (kind, x, z, size, fill) => {
    const t = `translate(${fx1(x)} ${fx1(z)}) scale(${fx1(size / 12)}) translate(-12 -12)`;
    const p = { keep: 'M4 4h16v7c0 5-4 8-8 10-4-2-8-5-8-10z', temple: 'M12 3l8 4.5v9L12 21l-8-4.5v-9z', muster: 'M12 4l9 16H3z', town: 'M12 5a7 7 0 1 0 0.01 0z' }[kind];
    return `<path transform="${t}" d="${p}" fill="${fill}" stroke="#0b0c0e" stroke-width="2"/>`;
  };
  for (const R of REALMS) {
    g += glyph('town', R.town.x, R.town.z, 15, '#e9dfc9') + glyph('muster', R.musterSite.x, R.musterSite.z, 15, R.color);
    const T = WAR.temples[R.id];
    g += glyph('temple', T.site.x, T.site.z, 16, R.color);
    const home = WAR.relics.filter((x) => x.state === 'temple' && x.at === R.id).length;
    for (let i = 0; i < home; i++) g += `<circle cx="${fx1(T.site.x - 8 + i * 8)}" cy="${fx1(T.site.z + 22)}" r="4.5" fill="#ffe28a" stroke="#0b0c0e" stroke-width="1.5"/>`;
  }
  for (const K of WAR.keeps) g += glyph('keep', K.site.x, K.site.z, 17, REALMS[K.realm].color);
  for (const R of REALMS) {
    const p = at(R, 298, 0);
    g += `<text x="${fx1(p.x)}" y="${fx1(p.z + 10)}" text-anchor="middle" font-family="IM Fell English SC, Georgia, serif" font-size="42" fill="${R.light}" stroke="#0b0c0e" stroke-width="6" paint-order="stroke">${R.name}</text>`;
  }
  // the Lone Tree and the Barrow
  g += `<g transform="translate(0 -4)"><path d="M-2,8v-12h4v12z" fill="#2a2016"/><circle cx="0" cy="-10" r="11" fill="#3f5a34" stroke="#0b0c0e" stroke-width="2"/></g>`;
  g += `<path d="M${BARROW.x - 14},${BARROW.z + 6}q14,-22 28,0z" fill="#7fd6d0" stroke="#0b0c0e" stroke-width="2"/>`;
  g += `<text x="0" y="38" text-anchor="middle" font-family="Alegreya Sans, sans-serif" font-size="28" fill="#efe6d3" stroke="#0b0c0e" stroke-width="6" paint-order="stroke">Lone Tree</text>`;
  g += `<text x="${BARROW.x + 8}" y="${BARROW.z - 18}" text-anchor="middle" font-family="Alegreya Sans, sans-serif" font-size="26" fill="#a9e6e0" stroke="#0b0c0e" stroke-width="6" paint-order="stroke">Barrow</text>`;
  // you
  const px = inDungeon(P) ? BARROW.x : P.x, pz = inDungeon(P) ? BARROW.z : P.z;
  if (Math.abs(px) < 440 && Math.abs(pz) < 440) g += `<g transform="translate(${fx1(px)} ${fx1(pz)}) rotate(${fx1(180 - P.yaw / DEG)})"><path d="M0,-13L9,11L0,5L-9,11Z" fill="#fff" stroke="#0b0c0e" stroke-width="2.5"/></g>`;
  return g + '</svg>';
}

const REALM_LORE = [
  { tag: 'Stone keeps and wheat fields', hallow: 'a cup that heals what is offered to it in good faith', kind: 'Orderly, proud and stubborn.',
    story: 'Logres was founded by the captain who carried the Grail out through the southern pass. Its people are builders and farmers: they raise square keeps of dressed stone, roof their halls with slate and plough the rolling downs into wheat. They hold that the March was given to them to keep in order. Its knights fight in mail behind long shields and its priests carry the Grail\'s light into battle, while outlaws hide in its woods and the dead stir in its old barrows.' },
  { tag: 'Green glens and standing stones', hallow: 'the stone that cries out under the rightful ruler', kind: 'Quick, proud and fey.',
    story: 'Ériu was founded by the captain who carried Lia Fáil west through the hills. Its people live in round houses inside ringforts of mossy stone, keep the old standing stones and trust the mists of the glens to hide them. They say the stone will cry out under the rightful ruler of the March, and that it has been silent since the oath broke. Its warriors are quick, its mages sing fire and frost, and pale lights drift over its bogs at night.' },
  { tag: 'Pine forests and long winters', hallow: 'a ring that gives back more than it is given', kind: 'Hardy, generous and fierce.',
    story: 'Thule was founded by the captain who carried Draupnir north through the snows. Its people build long timber halls among the pines and count their wealth in rings. Winter there is long and the dead do not always stay buried: draugr walk the Rimewood and trolls haunt its hills. Its jarls say Draupnir gives back more than it is given, and that the realm that holds it will never go hungry.' },
];
function chronRealms() {
  const me = GAME.player.faction;
  const cards = REALMS.map((R) => {
    const L = REALM_LORE[R.id];
    const keeps = WAR.keeps.filter((K) => K.realm === R.id).map((K) => K.site.name);
    const held = WAR.relics.filter((x) => x.state === 'temple' && x.at === R.id && x.realm !== R.id).map((x) => REALMS[x.realm].hallowName);
    const own = WAR.relics[R.id];
    const where = own.state === 'temple' ? (own.at === R.id ? 'safe in its temple' : `held by ${REALMS[own.at].name}`) : own.state === 'carried' ? 'being carried across the March' : 'lying in the field';
    return `<article class="card rcard" style="--rc:${R.color}">
      <div class="rhead"><span class="em">${emblemSvg(R.id, 30)}</span><b>${R.name}</b><i>${L.tag}</i>${R.id === me ? '<small>Your realm</small>' : ''}</div>
      <p>${L.story} <b>${L.kind}</b></p>
      <dl class="facts"><dt>Homeland</dt><dd>${R.homeName}, with the town of ${R.townName}</dd><dt>Hallow</dt><dd>${R.hallowName}, ${L.hallow} <span>· now ${where}</span></dd><dt>Temple</dt><dd>${R.templeName}</dd><dt>Keeps</dt><dd>${R.keepNames.join(' and ')}</dd><dt>Holds now</dt><dd>${keeps.length ? keeps.join(', ') : 'no keeps'}${held.length ? ` <span>· and ${held.join(' and ')}</span>` : ''}</dd></dl>
    </article>`;
  });
  return `<p>Three captains carried the hallows out of the March, and each founded a realm beyond a pass. Their people still keep those hallows, and still claim the March as their own.</p>${cards.join('')}`;
}

const WAR_STEPS = [
  { t: 'Break the gate', s: ['Siege an enemy keep', 'and batter it down.'], ic: 'lgate' },
  { t: 'Slay the lord', s: ['Fight into the court', 'and kill its lord.'], ic: 'crown' },
  { t: 'Take the keep', s: ['Its banners turn to', 'your realm\'s colour.'], ic: 'lkeep' },
  { t: 'The temple opens', s: ['Its gate can now', 'be broken down.'], ic: 'ltemple' },
  { t: 'Carry the hallow', s: ['Take it home to your', 'own temple gate.'], ic: 'lhallow' },
  { t: 'Strike harder', s: ['+10% damage for each', 'foreign hallow held.'], ic: 'lup' },
];
// the cycle of the war as a diagram: wide (two rows that loop) or tall (one column)
function warDiagram(wide) {
  const me = REALMS[GAME.player.faction];
  const W = wide ? 800 : 340, H = wide ? 340 : 740;
  const pos = wide ? [[125, 78], [400, 78], [675, 78], [675, 262], [400, 262], [125, 262]] : WAR_STEPS.map((_, i) => [180, 62 + i * 116]);
  const bw = wide ? 210 : 284, bh = wide ? 98 : 88;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="How the war works: break a keep's gate, slay its lord, take the keep, its realm's temple opens, carry the hallow home, your realm strikes harder">
    <defs><marker id="ldg-ar${wide ? 'w' : 't'}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" fill="#dfc188"/></marker>
    <radialGradient id="ldg-glow${wide ? 'w' : 't'}"><stop offset="0" stop-color="#dfc188" stop-opacity="0.22"/><stop offset="1" stop-color="#dfc188" stop-opacity="0"/></radialGradient></defs>`;
  const mk = `url(#ldg-ar${wide ? 'w' : 't'})`;
  const line = (x0, y0, x1, y1, dash) => `<path d="M${x0},${y0}L${x1},${y1}" stroke="#dfc188" stroke-width="2.2" fill="none" marker-end="${mk}"${dash ? ' stroke-dasharray="6 6" stroke-opacity="0.7"' : ''}/>`;
  if (wide) {
    s += line(232, 78, 290, 78) + line(507, 78, 565, 78) + `<path d="M675,129C700,170 700,170 675,210" stroke="#dfc188" stroke-width="2.2" fill="none" marker-end="${mk}"/>` + line(568, 262, 510, 262) + line(293, 262, 235, 262);
    s += `<path d="M125,211C100,170 100,170 125,131" stroke="#dfc188" stroke-width="2.2" fill="none" stroke-dasharray="6 6" stroke-opacity="0.7" marker-end="${mk}"/>`;
    s += `<text x="140" y="174" font-family="Alegreya Sans, sans-serif" font-style="italic" font-size="13" fill="#efe6d3" fill-opacity="0.55">and the war goes on</text>`;
    s += `<circle cx="400" cy="170" r="46" fill="url(#ldg-glow${wide ? 'w' : 't'})"/>` + REALMS.map((R, i) => { const a = -Math.PI / 2 + i * TAU / 3; return `<circle cx="${fx1(400 + Math.cos(a) * 15)}" cy="${fx1(170 + Math.sin(a) * 15)}" r="8" fill="${R.color}" stroke="#0e1014" stroke-width="2"/>`; }).join('');
  } else {
    for (let i = 0; i < 5; i++) s += line(180, pos[i][1] + bh / 2 + 2, 180, pos[i + 1][1] - bh / 2 - 4);
    s += `<path d="M38,${pos[5][1]}C10,${pos[5][1]} 10,${pos[0][1]} 34,${pos[0][1]}" stroke="#dfc188" stroke-width="2" fill="none" stroke-dasharray="6 6" stroke-opacity="0.7" marker-end="${mk}"/>`;
  }
  WAR_STEPS.forEach((st, i) => {
    const [cx, cy] = pos[i], x0 = cx - bw / 2, y0 = cy - bh / 2;
    const accent = i >= 2 ? me.color : '#a9844c';
    s += `<rect x="${x0}" y="${y0}" width="${bw}" height="${bh}" rx="9" fill="#1b1d22" stroke="${i === 5 ? me.color : 'rgba(223,193,136,0.4)'}" stroke-width="${i === 5 ? 2 : 1.2}"/>`;
    const ix = x0 + 40, iy = cy;
    s += `<circle cx="${ix}" cy="${iy}" r="25" fill="${accent}" fill-opacity="0.18" stroke="${accent}" stroke-width="1.6"/>`;
    s += `<g transform="translate(${ix - 15} ${iy - 15}) scale(1.25)" fill="none" stroke="${i === 4 ? '#ffe28a' : '#efe6d3'}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[st.ic]}</g>`;
    s += `<text x="${x0 + 18}" y="${y0 + 17}" font-family="Alegreya Sans, sans-serif" font-weight="700" font-size="11" fill="#dfc188">${i + 1}</text>`;
    const tx = x0 + 76;
    s += `<text x="${tx}" y="${cy - 9}" font-family="Alegreya Sans, sans-serif" font-weight="700" font-size="15" fill="#efe6d3">${st.t}</text>`;
    s += st.s.map((ln, j) => `<text x="${tx}" y="${cy + 11 + j * 16}" font-family="Alegreya Sans, sans-serif" font-size="12.5" fill="#efe6d3" fill-opacity="0.72">${ln}</text>`).join('');
  });
  return s + '</svg>';
}
function chronWar() {
  const tide = REALMS.map((R) => {
    const keeps = WAR.keeps.filter((K) => K.realm === R.id).length;
    const held = WAR.relics.filter((x) => x.state === 'temple' && x.at === R.id && x.realm !== R.id);
    const own = WAR.relics[R.id];
    const ownAt = own.state === 'temple' ? (own.at === R.id ? 'at home' : `taken by ${REALMS[own.at].name}`) : own.state === 'carried' ? 'being carried' : 'in the field';
    return { R, keeps, held, ownAt, bonus: Math.round((REALM_BONUS[R.id] - 1) * 100) };
  });
  const best = tide.slice().sort((a, b) => b.held.length - a.held.length || b.keeps - a.keeps)[0];
  const tie = tide.filter((t) => t.held.length === best.held.length && t.keeps === best.keeps).length > 1;
  const lead = tie ? 'No realm has the upper hand: the March is evenly held.' : `<b style="color:${best.R.light}">${best.R.name}</b> has the upper hand${best.held.length ? `, with ${best.held.map((x) => REALMS[x.realm].hallowName).join(' and ')} in the ${best.R.templeName}` : `, holding ${best.keeps} keeps`}.`;
  return `<p>The war has one aim: to bring the other realms' hallows home. Every hallow you hold makes your realm stronger, and every hallow you lose makes an enemy stronger. This is how a hallow changes hands.</p>
    <figure class="figure"><div class="dg-wide">${warDiagram(true)}</div><div class="dg-tall">${warDiagram(false)}</div></figure>
    <ol class="how">
      <li><b>Break the gate.</b> A keep's gate is a target like any foe: strike it until it falls. Archers on the walls and guards in the court defend it. A gate left alone for half a minute starts to mend, and a broken gate is rebuilt once the keep has been quiet for forty seconds (longer, late in a long campaign).</li>
      <li><b>Slay the lord.</b> With the gate down, fight into the courtyard. The keep lord stands at its heart, and whoever lands the killing blow claims the keep for their realm.</li>
      <li><b>The keep is yours.</b> Its banners turn to your colours, its old garrison is gone and your realm's guards begin to arrive. Everyone of your realm nearby earns realm points.</li>
      <li><b>Their temple opens.</b> A temple gate cannot be harmed while its realm holds both of its own keeps. Once either falls, the gate can be broken, and it stays open to attack for three minutes after the keep is taken back.</li>
      <li><b>Carry the hallow home.</b> Break the temple gate, take the hallow (${LK().use}) and bring it to your own temple gate. A bearer walks slowly, cannot ride or fight, and drops the hallow if slain; a dropped hallow goes back to the temple it was taken from after a minute and a half.</li>
      <li><b>Strike harder.</b> Each foreign hallow in your temple adds a tenth to the damage of every soldier of your realm, you among them. Taking back your own hallow does not make you stronger, but it ends the enemy's gain.</li>
    </ol>
    ${campaignChronHTML() /* [campaign] how a campaign is won, the standing and past campaigns (08g_campaign.js) */}
    <div class="acts">${chronLink('sieges', 'Sieges and towers')}${chronLink('orders', 'Orders')}</div>${'' /* [guide] towersChronHTML moved to chronSieges (10e_guide.js) */}
    <div class="tide" role="table" aria-label="The war now"><span class="h" role="columnheader">Realm</span><span class="h c" role="columnheader">Keeps</span><span class="h c" role="columnheader">Bonus</span><span class="h w" role="columnheader">Its own hallow</span>
      ${tide.map((t) => `<span class="r" style="--rc:${t.R.color}"><i></i>${t.R.name}</span><span class="c">${t.keeps}</span><span class="c">${t.bonus ? '+' + t.bonus + '%' : '·'}</span><span class="w">${t.R.hallowName} ${t.ownAt}</span>`).join('')}</div>
    <p class="now">${lead}</p>`;
}

const ORDER_INFO = [
  { k: 'attack', ic: 'sword', t: 'Attack', when: 'The usual order', x: 'March on an enemy keep, lay siege to its gate, storm the courtyard and kill the lord. A band that takes a keep holds it for half a minute before its next order.' },
  { k: 'defend', ic: 'shield', t: 'Defend', when: 'A keep of ours is in danger', x: 'March to a keep whose gate is badly battered or broken, and fight the besiegers until it has been quiet for a while, or until it falls.' },
  { k: 'raid', ic: 'flame', t: 'Raid', when: 'An enemy temple lies open', x: 'Break the temple gate and seize a hallow, our own first if that enemy holds it. Only one realm raids a temple at a time; the others leave it be.' },
  { k: 'carry', ic: 'lcarry', t: 'Carry', when: 'One of the band holds a hallow', x: 'Escort the bearer home to the temple gate. The bearer walks slowly and cannot fight; the band fights around them.' },
  { k: 'retrieve', ic: 'lretrieve', t: 'Retrieve', when: 'The most urgent order of all', x: 'A hallow lies in the field, or an enemy is carrying ours away: run it down and take it back.' },
  { k: 'patrol', ic: 'lpatrol', t: 'Patrol', when: 'Raiders at our temple, or nothing to do', x: 'Guard our temple gate while raiders are at it. With nothing better to do, a band walks to our most battered keep and keeps watch. When a campaign ends, every band patrols home.' },
  { k: 'rally', ic: 'horn', t: 'Rally', when: 'Only at your command', x: 'Follow you about the frontier and fight at your side for five minutes, or until you fall or leave the frontier.' },
];
function orderLine(wb) {
  const O = wb.order, n = wbMembers(wb).length;
  if (!O) return { ic: 'lpatrol', t: `${n} soldiers awaiting orders`, ph: 'at the muster' };
  const I = ORDER_INFO.find((q) => q.k === O.type) || ORDER_INFO[0];
  let what = '';
  if (O.keep) what = O.keep.site.name;
  else if (O.temple) what = O.temple.site.name;
  else if (O.relic) what = REALMS[O.relic.realm].hallowName + (O.type === 'carry' ? ', home' : '');
  else if (O.node) { const K = WAR.keeps.find((q) => q.nav.gate === O.node), T = WAR.temples.find((q) => q.nav.tg === O.node); what = K ? K.site.name : T ? T.site.name : ''; }
  else if (O.type === 'rally') what = GAME.player.name;
  const ph = O.type === 'carry' ? 'bearing it home' : O.type === 'retrieve' ? 'giving chase' : O.type === 'patrol' ? 'on watch' : { travel: 'on the march', siege: 'at the gate', assault: 'storming the court', hold: 'holding it' }[O.phase] || '';
  return { ic: I.ic, t: `${wbName(wb, false)} · ${I.t}${what ? ': ' + what : ''}`, ph: `${n} soldiers · ${O.byPlayer ? 'your order · ' : ''}${O.home ? 'marching home' : O.type === 'rally' ? 'at your side' : ph}` }; // [campaign] band names, your orders
}
function chronOrders() {
  const P = GAME.player, R = REALMS[P.faction];
  const mine = WAR.warbands.filter((wb) => wb.realm === P.faction && !wb.dead);
  const live = mine.length ? mine.map((wb) => { const o = orderLine(wb); return `<div>${iconSvg(o.ic, 16)}<span>${esc(o.t)}</span><em>${o.ph}</em></div>`; }).join('') : `<div>${iconSvg('lpatrol', 16)}<span>No warbands of ${R.name} are in the field.</span><em>more gather at the muster</em></div>`;
  // [campaign] the commanders as they now think (08g_campaign.js)
  return `<p>Each realm has a commander who gives every warband an order, thinks again every few seconds, and says what each band is doing and why. The orders are cried in the log, drawn on the map and the minimap as routes to their objectives, and shown over each band's captain.</p>
    <div class="grid2">${ORDER_INFO.map((o) => `<div class="order"><b>${iconSvg(o.ic, 18)}${o.t}</b><em>${o.when}</em><p>${o.x}</p></div>`).join('')}</div>
    <h3>How a commander chooses</h3>
    <ol class="how"><li><b>Retrieve</b> a hallow lying in the field or being carried off: the nearest band on the march turns round for it.</li><li><b>Patrol</b> our own temple gate while raiders are at it.</li><li><b>Defend</b> a keep of ours whose gate is badly battered or broken. When a gate falls, the nearest band on the march turns back to save it.</li><li><b>Raid</b> an enemy temple left open, to bring our own hallow home, or to take the second hallow of a claim.</li><li><b>Attack</b> the best enemy keep: one our realm built and lost, one whose gate is already down, one that would give us a fourth keep, or one held by a realm close to winning. Nearer keeps and thinner garrisons count too, and a little chance decides between keeps that score about the same.</li><li><b>Patrol</b> our most battered keep when there is nothing else to do.</li></ol>
    <h3>Spreading out</h3>
    <p>Each band leans toward one of its realm's two fronts, so a realm fights in two places at once. Two bands of one realm go after the same keep only when it is decisive: its gate is down, it is ours by right, or it wins or saves the March. A commander also keeps out of a fight two other realms are already having, so all three armies rarely meet in one place.</p>
    <p>On the way, a band is <b>on the march</b>; at an enemy gate it <b>lays siege</b> and strikes the gate whenever no defender is in reach; once the gate falls it <b>storms the court</b>; after a capture it <b>holds</b> the keep. New bands of seven to ten soldiers gather at the muster every half minute or so, two to four at a time depending on your graphics setting. A realm down to its last keep musters bigger bands, faster, and late in a long campaign every muster sends larger bands of recruits.</p>
    <h3>Your orders</h3>
    <p>${cwCanCommand() ? 'You have earned the right to command.' : 'From realm rank 3 or level 20 you may command too.'} Open the map (${LK().map}), choose one of ${R.name}'s warbands, then pick a keep to attack or defend or an open temple to raid, or tell it to rally to you. A band holds your order until the deed is done, a keep taken, a siege lifted, a hallow seized or the rally over, and then its commander takes it back. You can hand it back to the commander at any time.</p>
    <h3>The warbands of ${R.name} now</h3>
    <div class="live">${live}</div>`;
}

const MOB_PLURAL = { wolf: 'Wolves', boar: 'Boars', bear: 'Bears', bandit: 'Outlaws', skeleton: 'Barrow dead', draugr: 'Draugr', troll: 'Trolls', wisp: 'Wisps' };
function campSummary(realm) {
  const by = new Map();
  for (const c of CAMPS) if (c.realm === realm && !c.elite) {
    const levels = [...(c.members || [])].map(getEnt).filter(e => e && e.alive && !e.removed).map(e => e.level);
    const lo = levels.length ? Math.min(...levels) : 1, hi = levels.length ? Math.max(...levels) : 1;
    const o = by.get(c.type) || [99, 0]; by.set(c.type, [Math.min(o[0], lo), Math.max(o[1], hi)]);
  }
  return [...by].sort((a, b) => a[1][0] - b[1][0]).map(([t, [a, b]]) => `${MOB_PLURAL[t] || t} <span class="num">${a}–${b}</span>`).join(' · ');
}
function chronWilds() {
  const P = GAME.player;
  const cons = [['grey', 'no reward'], ['green', 'easy'], ['blue', 'fair'], ['yellow', 'your equal'], ['orange', 'hard'], ['red', 'deadly']].map(([k, l], i) => `<span style="--c:${CON[i].col}"><i></i>${capFirst(k)}: ${l}</span>`).join('');
  const realms = REALMS.map((R) => `<dt style="color:${R.light}">${R.name}</dt><dd>${campSummary(R.id)}</dd>`).join('');
  const champs = REALMS.map((R) => {
    const list = CAMPS.filter((c) => c.realm === R.id && c.elite).map((c) => {
      const e = getEnt(c.eliteId);
      return `<li>${e && e.alive ? `<b>${esc(capFirst(e.name))}</b>` : '<b class="gone">fallen, for now</b>'}<small>${MOB_PLURAL[c.type] || c.type} · ${e && e.alive ? `level ${e.level}` : 'new recruits: level 1'}${late2Risen(c) ? ' · risen' : ''}</small></li>`;
    }).join('');
    return `<div class="card rcard" style="--rc:${R.color}"><div class="rhead"><span class="em">${emblemSvg(R.id, 22)}</span><b style="font-size:20px">${R.homeName}</b></div><ul class="champs">${list}</ul></div>`;
  }).join('');
  return `<p>Every realm's homeland is full of creatures. Each starts at level 1 and grows through its own experience. Check current levels before choosing a fight.</p>
    <h3>How dangerous is it?</h3>
    <p>The colour of a creature's name shows how it measures up to you. Grey creatures give no experience at all.</p>
    <div class="cons">${cons}</div>
    <h3>Creatures of the homelands</h3>
    <dl class="facts">${realms}</dl>
    <p class="now">The numbers are the current levels of living creatures, or level 1 for an empty camp's next recruits. Your bounty from the herald is circled on your map, and the gold gem marks your path's next step.</p>
    <h3>Champions of the borderlands</h3>
    <p>The wild edges of each realm hold camps led by named champions. A champion hits hard and takes a lot of killing, drops two pieces of good gear, and comes back five to seven minutes after it falls. Shared world development at level 40 unlocks risen champions in the three farthest camps of each homeland (the Deeds page). It does not raise anyone's combat level.</p>
    ${champs}
    <p class="now">You are level ${P.level}. Compare each champion's current level and bring allies for a difficult fight.</p>`;
}
function chronDragon() {
  const P = GAME.player, D = DRAGON, e = D.e;
  const lvl = e?.level || DRAGON_LEVEL;
  let now;
  if (!e || !e.alive || e.removed) now = 'Cinderwing has fallen. It will return.';
  else if (D.state === 'perch') now = `Cinderwing is resting on high ground in ${zoneAt(e.x, e.z).name}.`;
  else if (D.state === 'descend' || D.state === 'approach') now = 'Cinderwing is coming down to land.';
  else now = `Cinderwing is on the wing over ${zoneAt(e.x, e.z).name}.`;
  return `<p class="lead">Cinderwing is a great red dragon that makes its home in the skies over the March. It circles the frontier on the wind, and every so often it comes down to rest on high ground. Anyone who climbs up to it gets a fight.</p>
    <h3>How it fights</h3>
    <p>It bites whatever is in front of it, sweeps its tail at anything behind, roars, and breathes fire. Badly hurt, it takes to the air and makes a low run over the field, breathing a long line of fire, before it lands again. If no one is left fighting it, it heals and flies away.</p>
    <h3>Who should fight it</h3>
    <p>Cinderwing is <b>level ${lvl}</b>${P.level < lvl - 3 ? ', far beyond you alone' : ''}: a fight for the strong, or for many. Keep out of the line of its fire, keep away from its tail and keep a healer close. It grows through its own experience, independently of your level.</p>
    <h3>What it leaves</h3>
    <p>Three pieces of rare gear or better, a dragon scale and a heap of gold. It returns about fifteen minutes after it falls.</p>
    <p class="now">Now: ${now}</p>`;
}
function chronBarrow() {
  const S = BARROW_STATE;
  return `<p class="lead">When the captains carried the hallows away, they sealed the old king and his whole court in a barrow east of the hill. He had wanted never to die, and he did not: he hollowed. His court walks the halls with him still.</p>
    <h3>The way down</h3>
    <p>The barrow is a long grassy mound just east of the Lone Tree, with a ring of standing stones before its door. Walk into its passage and the way runs from the <b>Barrow Mouth</b> down the <b>Passage of Bones</b>, through the <b>Ossuary</b> and the <b>Side Crypt</b>, across the <b>Hall of Pillars</b> and the <b>Burning Gallery</b>, to the <b>Well of Souls</b> and the <b>Hollow King's Hall</b>. His <b>Vault</b> lies beyond.</p>
    <h3>Its dangers</h3>
    <ul class="plain"><li><b>The dead wake together.</b> Pull one pack at a time, and fall back toward the stair if a fight goes wrong.</li><li><b>The Burning Gallery</b> breathes fire from its vents in bursts. Cross between them.</li><li><b>The gate past the Well of Souls</b> opens only when its keeper, the Barrow Warden, falls.</li><li><b>The Hollow King</b> raises the dead from their tombs as you fight him. Kill what rises, or it will bury you.</li></ul>
    <h3>Who it is for</h3>
    <p>The dead grow through their own experience. Check their current levels, face one pack at a time and bring allies for the king. The king's vault opens when he falls and holds the best loot in the land. The dead return after six minutes, the warden after ten and the king after twelve. The stair by the mouth always leads back to the daylight.</p>
    <p class="now">Now: the Barrow Warden is ${S.wardenDead ? 'fallen, for now' : 'at his post'}; the Hollow King is ${S.kingDead ? 'dust, for now' : 'waiting on his throne'}.</p>`;
}
function chronPath() {
  const prog = GAME.prog, P = GAME.player, R = REALMS[P.faction], next = pathNext();
  const row = (S) => {
    const i = S.idx, done = prog.lore.done.includes(S.id), cur = S === next;
    const rw = rewardLabel(S, prog, !cur);
    return `<li class="${done ? 'done' : cur ? 'cur' : ''}"><span class="mk">${done ? '✓' : i + 1}</span><span><b>${S.title}</b>${cur ? `<small>${S.hint(R, prog)}</small>` : ''}</span><span class="rw">${iconSvg(rw.ic, 14)}${done ? 'Claimed' : rw.t}</span></li>`;
  };
  // [guide2] the step at hand and the two after it; the steps walked and the rest of the way each folded under a line (a
  // phone read the whole path, 1,700 px of it, to find the one step that mattered)
  const done = PATH_STEPS.filter((S) => prog.lore.done.includes(S.id)), ahead = PATH_STEPS.filter((S) => !prog.lore.done.includes(S.id));
  const near = ahead.slice(0, 3), far = ahead.slice(3);
  const fold = (title, list, open = false) => `<details class="cf"${open ? ' open' : ''}><summary><h3>${title}</h3></summary><div class="cf-b"><ol class="steps">${list.map(row).join('')}</ol></div></details>`;
  const nNotes = prog.lore.seen.filter((id) => FIELD_NOTES[id]).length;
  return `<p>${capFirst(guideNumber(PATH_STEPS.length))} steps from recruit to the height of your powers. Each pays a reward the moment you take it; the next always shows at the ${IS_TOUCH ? 'top left' : 'left'} of your screen, with a gold gem on your minimap where it is to be done. Take them in any order.</p>
    ${done.length ? fold(`${capFirst(guideNumber(done.length))} step${done.length === 1 ? '' : 's'} walked`, done) : ''}
    ${near.length ? `<ol class="steps">${near.map(row).join('')}</ol>` : `<p class="now">Every step is walked. The Aims page says what to aim for now.</p>`}
    ${far.length ? fold(`${capFirst(guideNumber(far.length))} more step${far.length === 1 ? '' : 's'} ahead`, far) : ''}
    <div class="acts">${chronLink('goals', 'Aims: what opens at 20, 30, 40 and 50')}${chronLink('notes', `Field notes (${nNotes})`)}</div>
    <div class="acts"><button type="button" class="btn" data-lore="prologue">Replay the prologue</button></div>`; // [guide] the link to Aims; [guide2] the field notes have their own page (10f_guide2.js)
}

/* ------------------------------------------------------------------ */
/* starting, saving, the frame                                         */
/* ------------------------------------------------------------------ */
function loreSanitize(o) {
  const ids = (a, ok) => (Array.isArray(a) ? [...new Set(a.filter((x) => typeof x === 'string' && ok(x)))] : []);
  if (!o || typeof o !== 'object') return null;
  return { done: ids(o.done, (x) => !!PATH_BY_ID[x]), seen: ids(o.seen, (x) => !!FIELD_NOTES[x]), pro: o.pro ? 1 : 0, pv: Number.isInteger(o.pv) && o.pv > 0 && o.pv <= PATH_VERSION ? o.pv : 1 }; // [guide] pv
}
function loreSaveData() {
  const L = GAME.prog && GAME.prog.lore;
  return L ? { done: L.done.slice(), seen: L.seen.slice(), pro: L.pro ? 1 : 0, pv: L.pv || PATH_VERSION } : null; // [guide] pv
}
// called at the end of startGame with what it was started from
function loreOnStart(save) {
  const prog = GAME.prog;
  const kept = loreSanitize(save.lore);
  const old = !kept && !save.fresh;
  prog.lore = kept || { done: [], seen: [], pro: 0, pv: PATH_VERSION };
  const pv0 = prog.lore.pv || 1; // [guide] the path a character's save knew: steps added since are new to it
  prog.lore.pv = PATH_VERSION;
  Object.assign(LORE, { ev: {}, bounty: prog.bounty, potions: INV.potions, carried: null, doors: new Map(), elites: new Set(), loot: new Set(LOOT), queue: [], noteUntil: 0, deathShown: false, watchT: 0, hudKey: '', fresh: !!save.fresh, keepRealm: null, dragonHit: 0, dragonLast: -99, campN: null }); // [guide] ([guide2] dragonHit: your share of its harm)
  GUIDE.made.length = 0; GUIDE.wallSeen = false; GUIDE.mark = null; GUIDE.markT = 0;
  for (const S of PATH_STEPS) {
    // steps already behind you are marked off quietly: levels you have, and for characters
    // from before the path, the early steps of a level you are past ([guide] and the early steps added since the
    // character's save was made)
    if ((S.level && prog.level >= S.level) || (old && S.old && prog.level >= S.old) || (S.pv > pv0 && S.old && prog.level >= S.old)) pathComplete(S, true);
  }
  buildPathHud();
  const fromTitle = performance.now() - LORE.begin < 4000;
  LORE.begin = -1e9;
  if (save.fresh && fromTitle) openPrologue(false);
  else if (save.fresh) setTimeout(() => { if (GAME.prog === prog) loreNote('start'); }, 1600);
  else if (old) setTimeout(() => { if (GAME.prog === prog) loreNote('news'); }, 2500);
  else if (kept && pv0 < PATH_VERSION) setTimeout(() => { if (GAME.prog === prog) loreNote('pathnew'); }, 2500); // [guide] what the path gained since the save was made
}
// the title screen's "Enter the realm" means a new character: it gets the prologue
$('btn-begin').addEventListener('click', () => { if (!GAME.started) LORE.begin = performance.now(); }, true);

function updateLore(dt) {
  const prog = GAME.prog;
  if (!prog || !prog.lore || !GAME.player) return;
  LORE.watchT -= dt;
  if (UI.modal !== 'prologue' && LORE.watchT <= 0) {
    LORE.watchT = 0.25;
    loreWatch();
  }
  // the death sheet
  if (UI.modal === 'death') { if (!LORE.deathShown) { LORE.deathShown = true; deathNote(); } }
  else LORE.deathShown = false;
  // one field note at a time, never over an open window ([guide] nor a fight, unless it is about the fight)
  if (LORE.queue.length && !UI.modal && performance.now() > LORE.noteUntil && GAME.player.alive) showNextNote();
  updateGuide(dt); // [guide] the next step's place (10e_guide.js)
  LORE.hudT -= dt;
  if (LORE.hudT <= 0) { LORE.hudT = 0.3; renderPathHud(); }
  LORE.placeT -= dt;
  if (LORE.placeT <= 0) { LORE.placeT = 0.25; placePathHud(); }
}

/* ------------------------------------------------------------------ */
/* the loading screen                                                  */
/* ------------------------------------------------------------------ */
(function loreLoadingTips() {
  const L = $('loading'), inner = L && L.querySelector('.inner');
  if (!inner) return;
  const el = document.createElement('div');
  el.className = 'lore-ltip';
  el.setAttribute('aria-live', 'polite');
  inner.appendChild(el);
  const order = shuffle(Math.random, LOADING_TIPS.slice());
  let i = 0;
  const show = () => { el.innerHTML = `<b>From the Chronicle</b>${order[i++ % order.length]}`; };
  show();
  const timer = setInterval(() => {
    if (GAME.ready || L.hidden) { clearInterval(timer); return; }
    el.style.opacity = 0;
    setTimeout(() => { show(); el.style.opacity = 1; }, 450);
  }, 6000);
})();

/* ------------------------------------------------------------------ */
/* test hooks: window.__hm.LORE                                        */
/* ------------------------------------------------------------------ */
queueMicrotask(() => {
  if (!window.__hm) return;
  window.__hm.LORE = {
    state: LORE, steps: PATH_STEPS, notes: FIELD_NOTES, tips: LOADING_TIPS,
    openPrologue, closePrologue, prologueGo, openChronicle, renderChronicle, loreNote, pathNext,
    complete(id) { const S = PATH_BY_ID[id]; if (S) pathComplete(S); return !!S && pathDone(id); },
    check() { loreWatch(); },
    progress() { const L = GAME.prog && GAME.prog.lore; return L ? { done: L.done.slice(), seen: L.seen.slice(), pro: L.pro, next: (pathNext() || {}).id || null } : null; },
    fn: { startGame, validSave, buildSave, coreKey, loreSanitize, loreSaveData },
  };
});
