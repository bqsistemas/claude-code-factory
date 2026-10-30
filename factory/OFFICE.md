# Agent Office

The office is a read-only visual projection of `board.jobs`; it has no separate job state, persistence, or service. `office.js` turns jobs and `activity.js`'s authoritative `activeAgents()` result into locations, status tokens, accessible labels, and drawer targets. `office-map.js` owns the 3×3 room geometry, furniture, walls, collision footprints, seats, and waypoint graph. `office-navigation.js` routes/retargets walkers and advances animation. `office-renderer.js` paints the atlas, keyed keyboard/click hotspots, and the accessible status strip. `dashboard.html` only mounts the office beside the existing pipeline and board.

The map has a fixed 768×500 logical coordinate system that scales proportionally into the responsive office panel. Walk edges are checked against inflated wall, furniture, and monitor ground footprints; changing a destination finishes the current edge before following a new route. Reduced-motion mode places agents immediately. Parked jobs remain individually accessible from the status strip; when a parked room has more than four visible tokens, the map shows a `+N more` badge.

## Atlas

`assets/pixel-office-2/PixelOfficeAssets.png` is the untouched 768×512 source sheet. `build_atlas.py` makes `office-atlas-assets.png`, `atlas.json`, and `sprite-atlas.js` reproducibly from documented source rectangles, using Pillow and an alpha threshold of 200 to remove low-alpha colored fringe pixels. It does not resample or invent sprite pixels. The UI role uses the intact side pose because its hat pixels are incomplete; roles have one complete pose each, so movement is translation/bob, not fabricated walk cycles. The meeting table reuses a scaled clean table sprite.

Rebuild the atlas after changing source rectangles with:

```sh
python3 factory/assets/pixel-office-2/build_atlas.py
```

Run office behavior, collision, accessibility, and dashboard integration tests with:

```sh
node --test test/office.test.js test/office-redesign.test.js test/office-dashboard.test.js
```
