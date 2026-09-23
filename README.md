# Remotion stale-frame bug repro

Minimal reproduction for a frame-capture bug in **Remotion 4.0.527** on Linux (Chrome Headless Shell), where **sustained renders capture stale frame state** — frames come out as an earlier frame's visuals, or as the initial pre-animation state (all entrance animations at their `from` values, i.e. a black frame for this composition).

Single-frame renders (`remotion still`) are **always pixel-correct**, and short render batches (≤ ~5 frames per page) are always correct — the bug only appears when a page receives a sustained stream of frame seeks.

## Environment

```
Remotion:  remotion/@remotion/cli/@remotion/renderer 4.0.527 (all pinned, same version)
Node:      v26.9.0
OS:        Linux 7.0.0-31-generic x86_64 (KVM VPS, 8 vCPU AMD EPYC, 15 GB RAM, no GPU)
Browser:   Chrome Headless Shell (Remotion-pinned default)
React:     18.3.1
```

## Reproduce

```bash
npm install

# Ground truth — always correct:
npx remotion still Repro out/still-40.png --frame=40

# 75-frame sequence, default concurrency (~4 pages): ~56/75 frames stale/black
npx remotion render Repro --sequence out/frames

# 75-frame sequence, single concurrency (1 page handles all 75 seeks): 75/75 stale/black
npx remotion render Repro --sequence --concurrency=1 out/frames-1

# Short batch in a fresh process: 20/20 correct
npx remotion render Repro --sequence --frames=20-39 out/frames-20
```

Stale frames are **byte-identical** duplicates of one image (same md5), so the
corruption is easy to quantify on any image format:

```bash
md5sum out/frames/* | awk '{print $1}' | sort | uniq -c | sort -rn | head
# Verified from a clean install on the environment below:
#   56 fe75da4dbca61295aab2f26530887a09   <- the one stale image (black: every
#                                             entrance animation at scale: 0)
#    1 f14c919157236a719408c9794294e09e   <- 19 unique correct frames
#    1 c82d108a5fcd66f916f1c64dcc4d9795
#    ...
```

Because every entrance animation in `Repro` starts at `scale: 0`, the stale image
is uniform black. (When rendering jpeg sequences it compresses to ~13 KB vs
~45 KB for correct frames.)

## Measured results (4.0.527, this machine)

| Render                                             | Frames | Stale frames |
| -------------------------------------------------- | ------ | ------------ |
| `remotion still` (per frame)                        | 1      | 0            |
| `--sequence --frames=20-39` (fresh process)         | 20     | 0            |
| `--sequence` (default concurrency ≈ 4 pages)        | 75     | ~56 (~75%)   |
| `--sequence --concurrency=1` (1 page, 75 seeks)     | 75     | 75 (100%)    |
| `remotion render` (video, default concurrency)      | 75     | ~75%         |
| 1080-frame real-world composition, `--sequence`     | 1080   | mixed: stale repeated frames interleaved with correct ones |

Corruption correlates with **the number of sustained seeks per page**: ≤5 seeks/page → 0%,
≈19 seeks/page → ~75%, 75 seeks/page → 100%.

## Key evidence (see `diagnostics/observations.md` for full dumps)

A probe patched into `node_modules/@remotion/renderer/dist/screenshot-task.js`
dumps the DOM at the exact moment `Page.captureScreenshot` runs. At capture time:

- `window.remotion_renderReady === true`, the DOM is fully populated
  (`childElementCount: 33`) — the renderer-side "ready" handshake passed.
- The stale captures show **every entrance-animated element at its `from` value**
  (`scale: 0`) — i.e. the initial frame ≤ 2 state, for files named e.g. `element-40.jpeg`.
- Some captures show **mixed frame values inside one element's `style` attribute**:
  `translate` values matching frame 3 (to 5 decimals) while `scale` values in the
  same attribute imply frame ≥ 16 or frame ≤ 6. That state cannot be produced by
  any single render of the composition.

So the screenshot path and file path are healthy; **the page state itself was never
updated (or was torn) when the capture happened**.

## Ruled out (none change the corruption rate)

- Screenshot timing: an artificial **800 ms sleep before every capture** still gives
  56/75 stale frames — it is not a paint/compositor race.
- `Page.captureScreenshot` parameters: `fromSurface` (incl. `DISABLE_FROM_SURFACE`),
  `optimizeForSpeed`.
- `Target.activateTarget` before capture.
- The `document.body.style.background` DOM write before each screenshot.
- `screenshotTaskQueue` bypass (calling `screenshotTask` directly).
- A per-page mutex serializing `seekToFrame` + screenshot in
  `render-frame-with-option-to-reject.js`.
- `--gl=swangle`, jpeg vs png.
- Encoding/decoding: raw `--sequence` output shows identical corruption; two
  independent decoders agree.

## Suspect code

`packages/remotion/src/internals/TimelineContext.tsx` (as shipped in
`node_modules/remotion/dist/cjs/TimelineContext.js`), `window.remotion_setFrame`:

```js
window.remotion_setFrame = (f, composition, attempt) => {
  window.remotion_attempt = attempt;
  const id = delayRender(`Setting the current frame to ${f}`);
  let asyncUpdate = true;
  setFrame((s) => {
    const currentFrame = s[composition] ?? window.remotion_initialFrame;
    // Avoid cloning the object
    if (currentFrame === f) {
      asyncUpdate = false;
      return s;
    }
    return { ...s, [composition]: f };
  });
  // After setting the state, need to wait until it is applied in the next cycle
  if (asyncUpdate) {
    requestAnimationFrame(() => continueRender(id));
  } else {
    continueRender(id);
  }
};
```

Observations relevant to this code:

1. `continueRender` is scheduled in `requestAnimationFrame`, not after React has
   committed — and `asyncUpdate` assumes the updater function runs **synchronously**.
   Neither guarantees the DOM reflects `f` when the renderer's `waitForReady` passes.
2. The stale state is not merely *delayed* — the 800 ms capture-delay experiment
   shows it is *never applied*. Under a sustained seek stream the update appears to
   get dropped/coalesced (e.g. the updater's `currentFrame === f` fast-path, or the
   functional update batching under consecutive `setFrame` calls).

## Workaround

Render `--sequence` in **≤20-frame chunks** (fresh process per chunk) and reassemble.
0/2400+ stale frames observed across many real renders using this method.

See `diagnostics/observations.md` for the raw probe dumps and patch snippet.
