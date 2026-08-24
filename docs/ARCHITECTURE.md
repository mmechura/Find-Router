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
- `src/routing/workoutSteps.ts` — heuristický textový parser struktury
  tréninku (rozcvička/úseky/zotavení/vyklusání) z názvu a popisu tréninku
  v intervals.icu, viz níže.
- `src/routing/planMatcher.ts` — spojuje plánovaný trénink, jeho případnou
  strukturu a readiness do konkrétního požadavku na trasu (cílová
  vzdálenost, sport, preference terénu).
- `src/integrations/mapy.ts` — klient Mapy.com REST Routing API a
  generátor odkazu do plánovače Mapy.com.
- `src/integrations/strava.ts` — OAuth2 tok (authorize/token/refresh) a
  čtení aktivit.
- `src/integrations/intervals.ts` — čtení plánovaných tréninků
  (kalendářní eventy s `category=WORKOUT`).
- `src/app.ts` — sestavení Express aplikace (middleware + routery), bez
  `app.listen()`. `src/server.ts` ho spustí jako klasický proces (lokální
  vývoj, Docker); `api/index.ts` ho místo toho exportuje jako Vercel
  serverless funkci (viz `vercel.json`) — stejný Express app běží na obou.

## Jak appka pracuje s intervaly

Tohle je hlavní důvod, proč appka vznikla, tak stojí za samostatné vysvětlení.

**Důležité: GPX/trasa nese jen geometrii, ne tempo.** Garmin Edge umí
"pípat" na jednotlivé úseky (zahřátí / tvrdý úsek / volno) jedině přes
**strukturovaný trénink** nahraný samostatně (typicky přímo z intervals.icu
do Garmin Connect) — to appka neřeší a řešit nepotřebuje, protože to už
funguje. Úkolem appky je najít **správné místo**: trasu se správnou
celkovou vzdálenostní/terénem, a pro opakované úseky bezpečně opakovatelný
krátký okruh.

Proto appka po přečtení plánovaného tréninku:

1. Zkusí z názvu a popisu tréninku rozpoznat strukturu (`workoutSteps.ts`) —
   rozcvičku, N opakování daného úseku (s volitelným zotavením mezi nimi) a
   vyklusání. Je to textový heuristický parser (regulární výrazy na běžné
   formulace typu "6x1km (400m klus)" nebo "Warm up 10min, 8x400m, cool
   down 10min"), ne čtení skutečného strukturovaného pole z intervals.icu —
   k jeho přesnému schématu (`workout_doc`/`icu_intervals`) jsem se při
   stavbě appky nedostal (intervals.icu bylo z vývojového prostředí
   nedostupné). Očekávej, že vzorce bude potřeba doladit podle reálných
   popisů tvých tréninků.
2. Pokud strukturu rozpozná a trénink nemá explicitní celkovou vzdálenost,
   spočítá ji součtem všech úseků (přesnější než starý odhad
   "doba × tempo").
3. Spočítá `repeatSegmentKm` — délku jednoho tvrdého úseku + zotavení po
   něm. Pokud existuje, appka vedle hlavní trasy vygeneruje **druhý, krátký
   okruh** přesně této délky — to je místo, kde fyzicky odběháš/odjedeš
   daný počet opakování, místo aby appka nesmyslně cpala 6× stejný úsek do
   jedné dlouhé unikátní trasy.
4. **Terén se kvůli intervalům nezplošťuje.** Rovinu appka volí jen když má
   jít o opravdu volný/regenerační trénink (vysoká únava ze Strava dat,
   nebo klíčová slova jako "recovery"/"volno" v názvu) — intervalový nebo
   jinak intenzivní trénink je naopak typický případ, kdy je kopcovitější
   trasa v pořádku, nebo přímo žádoucí (kopcové intervaly, zajímavější
   terén na těžký trénink).

## Další vědomá omezení

- **Elevace/převýšení**: Mapy.com Routing API v dokumentovaném rozsahu
  nevrací převýšení po bodech, takže volba "rovina vs. kopce" jde jen přes
  profil (`foot_fast`/`bike_road` vs. `foot_hiking`/`bike_mountain`), ne
  přes tvrdou metrickou záruku převýšení.
- **Odhad tempa bez Strava historie**: pokud Strava není připojená nebo
  nemá aktivity daného sportu, použije se konzervativní výchozí tempo
  (běh 10 km/h, kolo 25 km/h) jen pro převod plánované doby na vzdálenost.
- **Mapy.com JS/dlaždicová API**: náhledová mapa v prohlížeči používá
  veřejné OpenStreetMap dlaždice (bez API klíče), aby fungovala hned "out
  of the box" — routing a finální export přesto jdou přes Mapy.com. Pokud
  chceš branding Mapy.com i v náhledu, stačí vyměnit `L.tileLayer(...)` v
  `public/app.js` za dlaždicový endpoint Mapy.com dle aktuální
  [developer.mapy.com](https://developer.mapy.com/) dokumentace.
