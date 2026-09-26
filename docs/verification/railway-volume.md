# Railway volume persistence (AIRTIGHT item 14)

**Verified: the `/data` volume survives redeploys.**

Method: on every start, the paper service (`keeper/src/service.ts`) reads `/data/.offmint-volume-marker.json`, increments
`boots`, and reports it at `/health` → `volume`. A fresh container without a volume would always show `boots: 1`.

| Check (UTC, 24 Sep 2026) | createdAt | boots | persisted |
|---|---|---|---|
| after the deploy that added the marker (commit fae47a1) | 09:15:26 | 1 | false |
| after two further redeploys (commits 7baefa5, b892dd0) | 09:15:26 | 3 | **true** |

Same `createdAt` across three container boots means the file on `/data` outlived the containers. Paper-mode output
(`/data/paper`), the basket (`/data/basket.json`) and the detector cache live on the same volume.
