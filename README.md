# Signal Board — token radar

[![make.fun — token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme)
[![Rank](https://make.fun/badge/token-radar-01/ehsanzeinali/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme)
[![Reward](https://make.fun/badge/token-radar-01/ehsanzeinali/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme)

A self-contained dashboard for the `token-radar-01` sealed snapshot. It ranks protocols whose DefiLlama record carries no token, keeps live-token and wrapped-product records in separate views, and gives every ranked row a costed farm plan.

## What it does

- Reads `/input/snapshot.json` with the Node 22 standard library only.
- Ranks 198 records with no token on record. The 40-snapshot watchlist is the floor, not the ceiling, so 158 earlier records are included too.
- Separates 24 live-token comparables and 24 set-aside wrapped or exchange products; neither is mixed into the ranked board.
- Computes an implied value from snapshot fields alone:

  `implied = TVL × 0.32 × (1 + clamp(7d, −60, 150) × 0.006) × (0.80 + min(age, 1460) × 0.000342)`

  An unknown first-tracked date uses 365 days. No protocol name is special-cased. The number is this entry's own claim, not a forecast and not a statement by make.fun.
- Gives each ranked protocol six concrete steps with a capital amount, gas estimate, weekly routine, minimum hold, reward check and exit log.
- Ships an offline dashboard with search, category filter, sortable columns, three views and a per-protocol detail drawer.

## Run

```sh
mkdir -p out
node main.ts --input /input/snapshot.json --output out
```

`main.ts` writes `board.json`, `data.js`, the copied `dashboard/` and `screenshots/`, and a byte-exact `dossier.json` built by `vendor/makefun-board.ts`.

## Layout

- `main.ts` — entrypoint and output writer
- `lib/model.ts` — parsing, value model, ranking, farm plans and self-check
- `dashboard/` — offline `index.html`, `app.css`, `app.js`
- `screenshots/` — cover board, detail view and filtered view
- `vendor/makefun-board.ts` — make.fun's dossier builder, copied unchanged from the kit

## Reading the board

A missing token field is not proof that no token exists. The board says “no token on record” for the same reason the snapshot does. It does not predict whether or when a token will be issued, and it does not claim that any farm plan will receive a reward.

## License

MIT. See `LICENSE`.
