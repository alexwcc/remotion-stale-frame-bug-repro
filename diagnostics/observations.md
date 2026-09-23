# Full observations & probe

All measurements on the environment in the README (Remotion 4.0.527, Linux x64 KVM,
Chrome Headless Shell). Composition: `src/Repro.tsx` (75 frames @ 30fps, 1920x1080).

## 1. Corruption signatures

- Stale frames of this composition are uniform black (entrance animations all at
  `scale: 0`), JPEG size 12,998 bytes, **byte-identical md5 across all of them**
  (e.g. `e8fa678f`), vs ~45 KB unique files for correct frames.
- In a 1080-frame render of a real composition, stale frames showed **an earlier
  frame's full content** (e.g. frame 30 and frame 75 contained identical pixels),
  again with correct frames interleaved.
- Video renders show the same corruption (verified with two independent decoders:
  frame extraction and pixel statistics agree), so encode/decode is not involved.

## 2. Probe

Inserted after `const buffer = Buffer.from(result.data, 'base64');` in
`node_modules/@remotion/renderer/dist/screenshot-task.js`:

```js
const probeRes = await client.send('Runtime.evaluate', {
  expression: `JSON.stringify({
    ready: window.remotion_renderReady,
    kids: (document.getElementById('remotion-root') || document.body).childElementCount,
    htmlLen: document.body.innerHTML.length,
    vis: document.visibilityState,
    hidden: document.hidden,
    focus: document.hasFocus(),
    head: document.body.innerHTML.slice(0, 120)
  })`,
  returnByValue: true,
});
console.log('[PROBE]', 'bytes=' + buffer.length, probeRes.value.result.value);

const st = await client.send('Runtime.evaluate', {
  expression: `Array.from(document.querySelectorAll('[style]'))
     .map((e) => e.tagName + ':' + e.style.cssText).join(' ||| ')`,
  returnByValue: true,
});
console.log('[STYLES]', st.value.result.value);
```

(Note: Remotion's vendored puppeteer wraps CDP responses in `{value: ...}`.)

At every capture, including stale ones:

```
[PROBE] bytes=12998 {"ready":true,"kids":33,"htmlLen":5979,"vis":"visible","hidden":false,"focus":true,...}
```

`remotion_renderReady === true`, page visible/focused, DOM fully populated. The
renderer-side handshake passed while the DOM still showed older state.

## 3. Raw style dumps

### Stale capture (`element-00.jpeg`, 12,998 bytes, uniform black)

Trimmed to the animated elements:

```
SPAN:font-family: sans-serif; font-size: 150px; color: rgb(255, 255, 255); display: inline-block; scale: 0;
SPAN:font-family: sans-serif; font-size: 150px; color: rgb(255, 255, 255); display: inline-block; scale: 0;
DIV:width: 150px; height: 150px; border-radius: 75px; background-color: rgb(255, 255, 255); scale: 0; translate: 0px 1.26573px;
DIV:width: 150px; ... scale: 0; translate: 0px 6.91448px;
DIV:width: 150px; ... scale: 0; translate: 0px -0.915314px;
DIV:width: 150px; ... scale: 0; translate: 0px -6.96086px;
DIV:width: 150px; ... scale: 0; translate: 0px 0.56255px;
DIV:position: absolute; top: 810px; ... align-items: center; scale: 0;
```

Every entrance animation at its `from` value (`scale: 0`). The `translate` values
match **frame 2 exactly**: `Math.sin((2 + i*17)/11) * 7` for i = 0..4 produces
`1.26573, 6.91448, -0.91531, -6.96086, 0.56255` — all 5 match. This is a
consistent **frame-2 state** captured for a file that should hold another frame.

### Capture with mixed values (one file, one element's `style` attribute)

```
DIV:width: 150px; ... translate: 0px 1.88551px;                        <- no scale
DIV:width: 150px; ... scale: 0; translate: 0px 6.78689px;
DIV:width: 150px; ... scale: 0; translate: 0px -1.54157px;
DIV:width: 150px; ... scale: 0; translate: 0px -6.86502px;
DIV:width: 150px; ... scale: 0; translate: 0px 1.19366px;
```

The `translate` values match **frame 3 exactly** (`sin((3+i*17)/11)*7` =
`1.88551, 6.78689, -1.54157, -6.86502, 1.19366`), while `scale` values in the same
attributes are `0` for circles 1–4 (frame ≤ 6/10/14/18) and unset (= 1) for
circle 0 and the text spans (frame ≥ 16). Both properties come from the same
`frame` variable in one style object — this DOM state cannot be produced by any
single render of `Repro.tsx`.

## 4. Experiments that do NOT change the corruption rate

75-frame `--sequence` runs, stale/75 in parentheses:

- Baseline (56)
- `SCREENSHOT_DELAY_MS=800` — 800 ms sleep immediately before every
  `Page.captureScreenshot` (56). Rules out screenshot-vs-paint/commit races.
- `DISABLE_FROM_SURFACE=1` → `fromSurface: false` (56).
- `optimizeForSpeed: false` in `Page.captureScreenshot` (57).
- `Target.activateTarget` removed (57).
- `document.body.style.background` DOM writes removed (56).
- `screenshotTaskQueue` bypassed — `screenshotTask` called directly (56).
- Per-page `WeakMap` promise-mutex serializing the whole
  `seekToFrame → takeFrame` critical section of `render-frame-with-option-to-reject.js` (56).
- `--gl=swangle`, png format — same pattern.

Since an 800 ms wait before capture does not help and a per-page serialization of
seek+capture does not help, the stale state is not a race against the capture: the
state update itself was lost or torn before/while the readiness handshake resolved.

## 5. Frames-per-page correlation

| Frames handled per page | Stale |
| ----------------------- | ----- |
| 1–5 (short `--frames=` ranges in fresh processes) | 0% |
| ~19 (75 frames, default concurrency) | ~75% |
| 75 (`--concurrency=1`) | 100% |

`remotion still` (one seek per page) is always correct. The bug needs a *sustained*
stream of `remotion_setFrame` calls on one page.
