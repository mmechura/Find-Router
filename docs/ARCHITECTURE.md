# Architektura

```
 Strava (OAuth2)              intervals.icu (API key)
        │                              │
        ▼                              ▼
 StravaClient                   IntervalsClient
 (posledních 28 dní aktivit)    (plánovaný trénink pro daný den)
        │                              │
        ▼                              │
 computeReadiness()                    │
 (acute:chronic zátěž,                 │
  únava, průměrné tempo)               │
        │                              │
        └───────────► buildRouteRequest() ◄───────────┘
                              │
                              ▼
                    generateLoopRoute()
                 (iterativní generátor okruhu,
                  volá Mapy.com Routing API)
                              │
                              ▼
                  Mapy.com REST Routing API
              (snapování na reálné cesty/silnice,
               vrací délku, čas, geometrii)
                              │
                              ▼
                  buildMapyPlannerUrl()
                              │
                              ▼
        Mapy.com plánovač tras (prohlížeč)
        → uživatel dotáhne detaily a použije
          nativní Export → GPX
                              │
                              ▼
                    Garmin Edge (GPX import)
```

## Klíčové moduly

- `src/routing/geo.ts` — sférická geometrie (haversine, destinationPoint) a
  seedovaný PRNG pro reprodukovatelné trasy.
- `src/routing/loopRouteGenerator.ts` — jádro aplikace: z výchozího bodu a
  cílové vzdálenosti navrhne tvarové body okruhu, nechá je Mapy.com
  Routing API "přichytit" na skutečné cesty a iterativně upravuje poloměr,
  dokud se skutečná délka trasy neshoduje s cílovou (výchozí tolerance 7 %,
  max. 5 iterací).
- `src/routing/readiness.ts` — zjednodušený odhad akutní/chronické zátěže
  ze Strava aktivit (náhrada za skutečné HRV/klidový tep, které Strava
  API neposkytuje) + průměrné tempo pro daný sport.
- `src/routing/planMatcher.ts` — spojuje plánovaný trénink a readiness do
  konkrétního požadavku na trasu (cílová vzdálenost, sport, preference
  rovinatosti).
- `src/integrations/mapy.ts` — klient Mapy.com REST Routing API a
  generátor odkazu do plánovače Mapy.com.
- `src/integrations/strava.ts` — OAuth2 tok (authorize/token/refresh) a
  čtení aktivit.
- `src/integrations/intervals.ts` — čtení plánovaných tréninků
  (kalendářní eventy s `category=WORKOUT`).

## Vědomá omezení

- **Elevace/převýšení**: Mapy.com Routing API v dokumentovaném rozsahu
  nevrací převýšení po bodech, takže "vyhýbání se kopcům" je jen heuristika
  přes volbu profilu (`foot_fast`/`bike_road` vs. `foot_hiking`/
  `bike_mountain`), ne tvrdá záruka.
- **Strukturované intervaly**: generátor cílí na celkovou vzdálenost/čas
  tréninku, ne na konkrétní strukturu (např. 6× 1 km na rovině + rozcvička
  do kopce). Rozšíření o segmentaci trasy podle `icu_intervals` je
  navazující krok.
- **Odhad tempa bez Strava historie**: pokud Strava není připojená nebo
  nemá aktivity daného sportu, použije se konzervativní výchozí tempo
  (běh 10 km/h, kolo 25 km/h) jen pro převod plánované doby na vzdálenost.
- **Mapy.com JS/dlaždicová API**: náhledová mapa v prohlížeči používá
  veřejné OpenStreetMap dlaždice (bez API klíče), aby fungovala hned "out
  of the box" — routing a finální export přesto jdou přes Mapy.com. Pokud
  chceš branding Mapy.com i v náhledu, stačí vyměnit `L.tileLayer(...)` v
  `public/app.js` za dlaždicový endpoint Mapy.com dle aktuální
  [developer.mapy.com](https://developer.mapy.com/) dokumentace.
