# Floorwalk fixtures

The Sample Footage for the Floorwalk demo: body-camera walks through two fictional premises in the Republic of Meridia. Every frame carries a SPECIMEN line; nothing in them is a real place, company or person.

| Slug | Site | Planted problems | Decoys |
| --- | --- | --- | --- |
| `cold-store` | Saltmarsh Cold Store, a chilled warehouse | blocked fire exit, unmarked spill, leaning stock, chiller wedged open, worker without hi-vis, extinguisher behind crates | a signed spill, a worker in a vest |
| `grocer` | Harbour Street Grocer, a supermarket | empty bay, shelf edge with no price labels, smashed jar with no sign, carton in the aisle, chiller door open, boxes against the fire exit | water by the produce, already signed |

## How they are made

`scene.html` is a Three.js scene built from a Site in `src/features/floorwalk/domain/sites.ts`: racks, doors, props, a camera route with glances, and a body-camera HUD. `renderAt(t)` is a pure function of time, so a render is deterministic.

`pnpm render:floorwalk-samples` opens it in headless Chromium (Playwright, SwiftShader WebGL), renders every frame at 24 fps, encodes `public/floorwalk/samples/<slug>.mp4` and a poster with ffmpeg, and writes the answer key to `src/features/floorwalk/domain/answer-key.generated.json`: for each planted problem and decoy, the seconds it is in view (its props projected on screen and not hidden behind a rack) and its box at its clearest frame.

Three.js is fetched from jsDelivr at render time only; the app does not ship it.

`node --env-file=.env.local --experimental-strip-types scripts/record-floorwalk-walks.mts --base http://localhost:3000` then records a real Walk of each Sample through the running app (it spends about four cents) into `public/floorwalk/samples/<slug>.walk.json`, which the page replays. Format them with `pnpm exec biome format --write public/floorwalk/samples`. Re-record after re-rendering, because the timings move.
