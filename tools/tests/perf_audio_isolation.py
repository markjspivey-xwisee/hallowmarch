"""Browser regression for perf.py's audio modes and wall-time independent medium siege.

The default draws keep every preceding CI view through siege. The two fresh
pages use different real-time pauses after trusted input; their draw signatures
must match. The explicit audio option retains real Web Audio.
"""
import asyncio
import importlib.util
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.argv = [str(HERE / 'perf.py'), 'medium', 'render', 'budget',
            'views=town,keep,hall,river,battle,forest,barrow,mountain,siege']
spec = importlib.util.spec_from_file_location('perf_audio_subject', HERE / 'perf.py')
perf = importlib.util.module_from_spec(spec)
spec.loader.exec_module(perf)


def draw_signature(report):
    # GPU/JS time and heap intentionally vary. Geometry and populations must not.
    return {view: {key: sample[key] for key in ('calls', 'tris', 'main', 'shadow', 'rows')}
            for view, qualities in report['views'].items()
            for sample in [qualities['medium']]}


async def default_run(tag, pause_ms):
    perf.TAG = tag
    original_ev = perf.ev

    async def delayed_ev(page, js):
        if js.startswith("PV.view('siege')"):
            await page.wait_for_timeout(pause_ms)
        result = await original_ev(page, js)
        if js == "window.__rafHold = true; 0":
            # The page has received the same trusted Shift as the normal driver.
            await page.wait_for_timeout(pause_ms)
        return result

    perf.ev = delayed_ev
    try:
        await perf.main()
    finally:
        perf.ev = original_ev
    report = json.loads(pathlib.Path(perf.OUT + 'perf_' + tag + '.json').read_text())
    assert report['boot']['audio'] == 'none', report['boot']
    assert not report['errors'] and not report['over'], report
    return report


async def explicit_audio():
    # Set the real driver's audio option: its init must retain browser capability.
    perf.ARGS.append('audio')
    try:
        async with perf.async_playwright() as p:
            browser, page, logs = await perf.setup(p, touch=False, w=perf.W, h=perf.H, init=perf.benchmark_init())
            try:
                await perf.ev(page, "window.__rafHold = true; 0")
                await page.mouse.click(8, 8)
                await page.wait_for_timeout(1500)
                before = await perf.ev(page, """(() => {
                  __hm.frame();
                  const ctx = __hm.fn.AUDIO.ctx;
                  return {capability: typeof window.AudioContext, state: ctx?.state || 'none',
                    time: ctx?.currentTime || 0, errors: __hm.errors};
                })()""")
                await page.wait_for_timeout(300)
                after = await perf.ev(page, "__hm.fn.AUDIO.ctx?.currentTime || 0")
                assert before['capability'] == 'function' and before['state'] == 'running', before
                assert after > before['time'], {'before': before, 'after': after}
                assert not before['errors'] and not logs, {'audio': before, 'logs': logs}
                return {'state': before['state'], 'clockAdvanced': True}
            finally:
                await browser.close()
    finally:
        perf.ARGS.remove('audio')


async def main():
    first = await default_run('audio-isolation-immediate', 0)
    second = await default_run('audio-isolation-delayed', 4500)
    a, b = draw_signature(first), draw_signature(second)
    assert a == b, {'immediate': a, 'delayed': b}
    audio = await explicit_audio()
    summary = {'defaultAudio': 'none', 'wallPausesMs': [0, 4500],
               'sameDrawSignatures': True, 'siege': a['siege'],
               'explicitAudio': audio}
    pathlib.Path(perf.OUT + 'perf_audio_isolation.json').write_text(json.dumps(summary, indent=1))
    print('AUDIO ISOLATION', json.dumps(summary), flush=True)


if __name__ == '__main__':
    asyncio.run(main())
