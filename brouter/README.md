# BRouter service (Variant 2, Milestone 1)

A self-hosted [BRouter](https://github.com/abrensch/brouter) instance,
used as an alternate routing engine for bike+road route requests only -
see `docs/ARCHITECTURE.md` for why (short version: the shipped Mapy.com-based
generator can't reliably produce genuinely flat routes in mountainous
terrain, and BRouter's elevation-aware round-trip search can). This is a
developer-facing milestone, gated behind `ROUTE_ENGINE=brouter` - most
deployments of find-router don't need this directory at all.

## What's here

- `Dockerfile` - builds BRouter from source (github.com/abrensch/brouter),
  bakes in find-router's own tuned profiles (below) and one segment data
  tile (below).
- `profiles/bike-road-flat.brf` / `profiles/bike-road-hilly.brf` - forks of
  BRouter's stock `trekking.brf` profile, tuned for "road bike, prefer
  paved" plus a strong elevation-avoidance cost (flat) or none (hilly, used
  as the contrast case in acceptance testing). See the `MILESTONE 1`
  comments inside each file for exactly what was changed from trekking.brf
  and why.
- `segments/` - where a locally-downloaded segment tile goes for local dev
  (gitignored - these are large binaries, not something to commit).

## Segment data (the road-network graph itself)

BRouter publishes prebuilt, weekly-updated regional graph files ("segments")
at `https://brouter.de/brouter/segments4/`, named
`[E|W]<lon>_[N|S]<lat>.rd5` for each 5°x5° tile (the `lon`/`lat` mark the
tile's south-west corner). Milestone 1 only needs the tile covering the
Beskydy/Jablunkov border area (Czech Republic/Poland/Slovakia) this project
is scoped to:

```
https://brouter.de/brouter/segments4/E15_N45.rd5
```

(covers roughly 15°E-20°E, 45°N-50°N - all of Czech Silesia/Moravia, the
Beskydy mountains, Slovakia, and southern Poland). Note this does **not**
cover Prague (14.4°E falls in the neighboring `E10_N45` tile) - add that
tile too (in `Dockerfile`'s `ADD` line and here for local dev) if you need
BRouter for a start point west of about 15°E.

The `Dockerfile` downloads this tile at **build time**, baking it into the
image, rather than expecting it mounted from a volume - Milestone 1's
hosting choice (Render's free tier, see `docs/ARCHITECTURE.md`) has no
persistent disk to mount one from.

## Local development

```
mkdir -p brouter/segments
curl -o brouter/segments/E15_N45.rd5 https://brouter.de/brouter/segments4/E15_N45.rd5
docker compose up brouter
```

This builds the same `Dockerfile` used for deployment, but bind-mounts your
local `brouter/segments/` and `brouter/profiles/` over the image's baked-in
copies (see `docker-compose.yml` at the repo root) - so you can swap a tile
or tweak a `.brf` profile without rebuilding the image. Once it's up, set in
your local `.env`:

```
ROUTE_ENGINE=brouter
BROUTER_URL=http://localhost:17777
```

...then run the app the normal way (`npm run dev`) - only bike-road
requests (see `useBRouterFor()` in `src/routes/route.ts`) actually use it;
everything else still goes through the Mapy.com-based generator regardless
of this setting.

## Deploying

Milestone 1's approved plan deploys this as its own **Render free-tier web
service**, separate from the main app (which stays on Vercel exactly as
before). Point Render at this `brouter/Dockerfile` (Root Directory:
`brouter`), and once it's live, copy its public URL into the main app's
`BROUTER_URL` environment variable.

Known limitation, accepted for Milestone 1: a free-tier service sleeps
after inactivity, so the first route-generation request after any idle
period can take tens of seconds to wake it - past Vercel Hobby's 10s
function timeout. This is fine for now since the BRouter path isn't
user-facing yet (see `docs/ARCHITECTURE.md`'s Milestone 1 scope) - revisit
before it ever is.
