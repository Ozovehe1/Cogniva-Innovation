#!/usr/bin/env python3
"""
Ink-under-pen test: nothing may appear on the whiteboard before the pen tip gets there.

Plays /learn/demo/ink-test (every element type, see src/lib/ink-test-lesson.ts) silently on a fake clock, one 33 ms
tick at a time. After each tick it screenshots the board and diffs it with the tick before: every pixel that newly
turned to ink (darkened by more than DARKEN levels) must lie within RADIUS px of the path the marker tip took during
that tick (window.__penTipProbe). The hand itself is made transparent so only ink is compared. Light tints (shape
fills, the highlight wash) are below the threshold by design: they wash in behind an outline the pen already drew.

Exit code 1 when any tick has more than MAX_STRAY stray ink pixels, or when an element never got ink at all.

usage: python3 scripts/test-ink-under-pen.py [BASE_URL] [--w 1000] [--out DIR]
needs: pip install playwright numpy pillow; a Chromium (PLAYWRIGHT_CHROMIUM or /usr/bin/chromium); a dev server
       (npm run dev) at BASE_URL (default http://localhost:3000).
"""
import argparse, asyncio, io, json, math, os, sys

import numpy as np
from PIL import Image
from playwright.async_api import async_playwright

TICK = 33
DARKEN = 70  # luminance drop (0-255) that counts as new ink
RADIUS = 46  # px from the tip path within which new ink is allowed (a sweep reveals an element's full height)
MAX_STRAY = 12  # stray ink pixels tolerated per tick (anti-aliasing noise)

ap = argparse.ArgumentParser()
ap.add_argument('base', nargs='?', default='http://localhost:3000')
ap.add_argument('--w', type=int, default=1000)
ap.add_argument('--out', default='')
ap.add_argument('--max-ms', type=int, default=90_000)
a = ap.parse_args()

INIT = """
try { localStorage.setItem('gm.whiteboard.sound', 'off') } catch (e) {}
window.__penTipProbe = []; window.__penInk = [];
document.addEventListener('DOMContentLoaded', () => {
  const s = document.createElement('style');
  s.textContent = '[data-hand], [data-hand] * { opacity: 0 !important } *, *::before, *::after { transition-duration: 0s !important; caret-color: transparent !important }';
  document.head.appendChild(s);
});
"""


def lum(png: bytes) -> np.ndarray:
    im = Image.open(io.BytesIO(png)).convert('RGB')
    return np.asarray(im, dtype=np.int16) @ np.array([299, 587, 114], dtype=np.int16) // 1000


def seg_dist(px: np.ndarray, py: np.ndarray, pts: list) -> np.ndarray:
    """Distance of each pixel to the polyline through pts (or a point)."""
    best = np.full(px.shape, np.inf)
    if len(pts) == 1:
        pts = pts * 2
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        dx, dy = x1 - x0, y1 - y0
        L = dx * dx + dy * dy
        t = np.zeros(px.shape) if L < 1e-6 else np.clip(((px - x0) * dx + (py - y0) * dy) / L, 0, 1)
        d = np.hypot(px - (x0 + t * dx), py - (y0 + t * dy))
        best = np.minimum(best, d)
    return best


async def main():
    out = a.out
    if out:
        os.makedirs(out, exist_ok=True)
    async with async_playwright() as p:
        exe = os.environ.get('PLAYWRIGHT_CHROMIUM') or ('/usr/bin/chromium' if os.path.exists('/usr/bin/chromium') else None)
        b = await p.chromium.launch(executable_path=exe, args=['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        ctx = await b.new_context(viewport={'width': a.w, 'height': 900}, device_scale_factor=1, is_mobile=a.w < 600, has_touch=a.w < 600)
        await ctx.add_init_script(INIT)
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)[:300]))
        await pg.clock.install()
        await pg.goto(a.base + '/learn/demo/ink-test', wait_until='domcontentloaded', timeout=180_000)
        for _ in range(600):
            await pg.clock.run_for(100)
            ok = await pg.evaluate("""()=>[...document.querySelectorAll('button[aria-label="Start lesson"]')].some(b=>!b.disabled&&b.offsetWidth)""")
            if ok:
                break
        else:
            print('FAIL: the lesson never became ready'); sys.exit(2)
        # Let the 3D hand load (it is transparent, but the tip is only probed while a hand view is attached).
        for _ in range(80):
            await pg.clock.run_for(100)
            if await pg.evaluate("()=>!!document.querySelector('[data-hand]')"):
                break
        # From here time only moves when the test moves it.
        now_ms = await pg.evaluate('Date.now()')
        await pg.clock.pause_at(now_ms + 50)
        await pg.evaluate("""()=>[...document.querySelectorAll('button[aria-label="Start lesson"]')].find(b=>b.offsetWidth&&!b.disabled).click()""")
        board = pg.locator('.wb-board').first
        await pg.clock.run_for(TICK)
        box = await board.bounding_box()
        prev = lum(await pg.screenshot(clip=box))
        h, w = prev.shape
        py, px = np.mgrid[0:h, 0:w]
        px = px + box['x']; py = py + box['y']
        last_tip = None
        bad = []
        t = 0
        stray_total = 0
        trace = []
        done_at = None
        while t < a.max_ms:
            await pg.clock.run_for(TICK)
            t += TICK
            tips = await pg.evaluate("()=>{const p=window.__penTipProbe||[];window.__penTipProbe=[];return p.map(s=>[s.x,s.y])}")
            cur = lum(await pg.screenshot(clip=box))
            new_ink = (prev - cur) > DARKEN
            n = int(new_ink.sum())
            if n:
                path = ([last_tip] if last_tip else []) + tips
                if not path:
                    stray = n
                    far = None
                else:
                    d = seg_dist(px[new_ink], py[new_ink], path)
                    stray = int((d > RADIUS).sum())
                    far = float(d.max())
                if stray > MAX_STRAY:
                    ys, xs = np.nonzero(new_ink)
                    bad.append({'t_ms': t, 'stray_px': stray, 'new_px': n, 'max_dist': far, 'bbox': [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())], 'tip': path[-1] if path else None})
                    if out:
                        Image.fromarray(cur.astype(np.uint8)).save(f'{out}/stray-{t:06d}.png')
                stray_total += stray
            if tips:
                last_tip = tips[-1]
            if t % 990 == 0:
                st = await pg.evaluate("()=>{const b=document.querySelector('.wb-board');return [b?.dataset.step,b?.dataset.clock,performance.now()|0]}")
                trace.append([t] + st)
            prev = cur
            # 'Play again' shows once the last step starts: play that step out too.
            if done_at is None and await pg.evaluate("()=>[...document.querySelectorAll('button')].some(b=>b.getAttribute('aria-label')==='Play again' && b.offsetWidth)"):
                done_at = t
            if done_at is not None and t - done_at > 8000:
                break
        ink = await pg.evaluate('window.__penInk || []')
        if out:
            await board.screenshot(path=f'{out}/final.png')
        await b.close()
    tags = [e['tag'] for e in ink]
    offsets = [{'tag': e['tag'], 'offset_ms': round(e['clock'] - e['cueAt'])} for e in ink if e['cueAt'] >= 0]
    fallback = [x for x in tags if x.startswith('fallback:')]
    res = {'ticks_ms': t, 'trace': trace, 'stray_ticks': bad, 'ink_jobs': len(ink), 'fallback_jobs': fallback, 'offsets': offsets, 'errors': errs[:5]}
    if out:
        json.dump(res, open(f'{out}/result.json', 'w'), indent=1)
    print(json.dumps(res, indent=1))
    if errs:
        print('FAIL: page errors'); sys.exit(1)
    if bad:
        print(f'FAIL: ink appeared ahead of the pen tip in {len(bad)} tick(s)'); sys.exit(1)
    if len(ink) < 20:
        print(f'FAIL: only {len(ink)} pen jobs inked (expected one per element)'); sys.exit(1)
    print('PASS: every mark appeared under the pen tip')


asyncio.run(main())
