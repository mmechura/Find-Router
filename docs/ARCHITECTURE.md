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
  max. 8 iterací). Každý kandidát se zároveň hodnotí podle `spurs.ts`
  (nechce žádný ošklivý slepý výběžek) a `excludedZones.ts` (nesmí vůbec
  vstoupit do zakázané zóny) — pokud kandidát neprojde, appka to nevzdá,
  jen si nechá vygenerovat jiný tvar okruhu v další iteraci a na konci
  vrátí nejlepší z těch, co viděla.
- `src/routing/spurs.ts` — detekuje "tam a zase zpátky" úseky v trase:
  když Mapy.com kvůli slepé uličce/vjezdu jinak nemůže danou trasu
  spojit, vrátí trasu, která do ní zajede a stejnou cestou se vrátí. Pozná
  se to jako zrcadlová symetrie v sekvenci souřadnic kolem bodu obratu.
- `src/routing/excludedZones.ts` — kombinuje ruční seznam s živým dotazem
  na OSM (viz níže) do jednoho `ExclusionChecker`; zóny jsou buď obdélník
  (ruční seznam) nebo skutečná linie cesty s bufferem (`polylineZone`,
  aby dlouhá diagonální cesta jako dálnice nevyřadila celý obdélník mezi
  svými konci).
- `src/routing/roadSnapper.ts` — přichytí navržený bod okruhu k nejbližšímu
  bodu na reálné silnici/cestě z OSM dat (`fetchRoadWays`), místo aby se
  použila syrová, potenciálně mimosilniční souřadnice.
- `src/routing/elevationProfile.ts` — z geometrie trasy a dat z Mapy.com
  Elevation API spočítá sklon po úsecích a zjistí, jestli někde překračuje
  povolený limit (buď všude stejný, nebo přísnější jen v konkrétním
  úseku vzdálenosti — `strictWindows`).
- `src/integrations/overpass.ts` — klient veřejného Overpass API
  (OpenStreetMap) — jeden pro zakázané/omezené cesty, druhý pro běžnou
  silniční síť k přichytávání bodů.
- `src/integrations/elevation.ts` — klient Mapy.com Elevation API
  (dávkově až 256 bodů najednou).
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

## Povrch a zakázané zóny

- **Povrch kola je volitelný.** `pickProfile()` pro `sport: 'bike'` bere
  navíc `surface: 'road' | 'gravel'` (posílá se z UI, výchozí `'road'`) —
  `road` → `bike_road` (asfalt, galusky), `gravel` → `bike_mountain`
  (Mapy.com nemá samostatný gravel profil, tohle je nejbližší "nezpevněné
  ok"). Preference rovina/kopce na tuhle volbu vliv nemá — jde čistě o to,
  jaké kolo je zrovna v hangáru.
- **Zakázané zóny — teď dynamicky, ne jen ručně.** Ruční seznam
  (`EXCLUDED_ZONES` v `excludedZones.ts`) neškáluje — nejde ručně
  posbírat každý oplocený/soukromý areál, na který appka může narazit.
  Místo spoléhání jen na něj appka před generováním trasy zavolá veřejné
  **Overpass API** (`src/integrations/overpass.ts`) a zeptá se
  OpenStreetMap dat na cesty/areály v okolí startu označené jako
  `access=private`/`access=no` nebo bránou (`barrier=gate`) — tohle
  pokrývá prakticky libovolné "sem nesmíš" místo, ne jen to jedno, co jsi
  nahlásil. Dotaz proběhne **jednou na trasu** (ne na každou iteraci) a
  najeté kandidáty appka vůbec nepřijme, pokud do takové oblasti vstupují.
  Ruční seznam zůstává jako záložní síť pro místa, která v OSM datech
  nemají správný tag (jako zatím u Třineckých železáren — je tam jen
  odhadovaný obdélník ze screenshotu, uvítám přesné souřadnice).
  Selhání dotazu na Overpass (výpadek, rate limit) appku nezastaví — jen
  potichu použije jen ruční seznam, viz `buildExclusionChecker()`.
- **Slepé výběžky se řeší agresivněji.** Pokud kandidátní trasa
  opakovaně naráží na zakázanou zónu nebo ošklivý výběžek, appka po pár
  neúspěšných pokusech (v rámci stejného rozpočtu iterací) sníží počet
  vynucených bodů okruhu — méně bodů znamená méně příležitostí trefit
  slepou uličku. Tohle je zmírnění pravděpodobnosti, ne stoprocentní
  záruka: u čistě náhodně kladených bodů se občas žádná čistá varianta
  v rámci pár pokusů nenajde, obzvlášť v hustě zastavěné čtvrti.

## Silnice, sklon a rychlost — jak appka staví trasu chytřeji

Původní model (náhodný bod na kružnici → doufej, že ho Mapy.com nějak
rozumně propojí) měl dva zásadní problémy: body nebyly zaručeně na
silnici, a appka neměla ponětí o skutečném terénu. Řeší se to takhle:

1. **Body okruhu jsou vždy na reálné cestě.** Appka si před generováním
   trasy stáhne z OSM (Overpass) místní silniční síť (`roadSnapper.ts`) a
   každý navržený bod okruhu přichytí k nejbližšímu skutečnému bodu na
   cestě (do 300 m — dál už by "přichycení" nedávalo smysl a použije se
   syrová souřadnice). To samo o sobě výrazně omezuje i slepé výběžky,
   protože appka už neklikne špendlík doprostřed pole nebo dvora.
2. **Sklon trasy se ověřuje proti skutečným datům.** Po vygenerování
   kandidátní trasy appka zavolá Mapy.com Elevation API a spočítá sklon
   po úsecích (`elevationProfile.ts`). Limit je buď jednotný pro celou
   trasu (4 % když má být trasa spíš rovina, 12 % jinak — pořád strop
   proti opravdu extrémním sklonům, ne bianco šek), nebo přísnější jen v
   konkrétní části trasy — u hlavní trasy se strukturovaným tréninkem tak
   vždycky dostane přísný 4% limit **rozcvička na začátku a vyklusání na
   konci** (`warmupKm`/`cooldownKm` z `planMatcher.ts`), i když je zbytek
   tréninku záměrně intenzivní. Právě tohle řeší "10% kopec v plánovaném
   Z1 intervalu" — appka to teď umí ověřit, ne jen doufat, že si to
   profil `foot_fast`/`bike_road` sám pohlídá.
   - Elevation API se volá **jen** u kandidáta, který už prošel levnějšími
     kontrolami (vzdálenost, výběžky, zakázané zóny) — jinak by to
     zbytečně násobilo počet síťových volání na neúspěšné pokusy.
   - Opakovací okruh na intervaly dostává jeden jednotný limit (žádná
     přísná okna) — je to jeden krátký úsek s jedním typem úsilí, ne
     sled fází jako hlavní trasa.
3. **Rychlost je vstup, ne jen odhad.** UI má editovatelné pole
   "Průměrná rychlost" — appka ho předvyplní tvým průměrem z poslední
   Strava historie (`readiness.recentAvgSpeedKmh`), nebo výchozí hodnotou
   appky, pokud Strava není připojená nebo pro daný sport nemá historii.
   Změna rychlosti přepočítá cílovou vzdálenost, rozdělení
   rozcvička/vyklusání i velikost opakovacího okruhu okamžitě přes
   `POST /api/route/preview` (bez volání Mapy.com/Overpassu — je to čistě
   aritmetika z `planMatcher.ts`, takže je to levné a rychlé i při psaní
   do pole).

**Vědomě zjednodušeno oproti "dokonalému" řešení**: appka pořád nestaví
skutečný graf silniční sítě a nehledá v něm okruh (to by bylo o řád víc
práce — stažení a údržba grafu, algoritmus hledání okruhu s omezeními).
Místo toho kombinuje "namíř náhodně, přichyť na silnici, ověř sklon,
zkus znovu, když to nevyjde" — funguje to podstatně líp než čistě náhodné
body, ale pořád to je heuristika s omezeným počtem pokusů (`maxIterations`,
výchozí 8), ne garance. Pokud appka ani po variantě 1 nedává dost kvalitní
trasy v konkrétním terénu, skutečný graf-based přístup je logický další
krok, ale je to samostatný, mnohem větší projekt.

## Další vědomá omezení

- **Odhad tempa bez Strava historie**: pokud Strava není připojená nebo
  nemá aktivity daného sportu, použije se konzervativní výchozí tempo
  (běh 10 km/h, kolo 25 km/h) — buď automaticky, nebo si ho přepiš v UI.
- **Mapy.com JS/dlaždicová API**: náhledová mapa v prohlížeči používá
  veřejné OpenStreetMap dlaždice (bez API klíče), aby fungovala hned "out
  of the box" — routing a finální export přesto jdou přes Mapy.com. Pokud
  chceš branding Mapy.com i v náhledu, stačí vyměnit `L.tileLayer(...)` v
  `public/app.js` za dlaždicový endpoint Mapy.com dle aktuální
  [developer.mapy.com](https://developer.mapy.com/) dokumentace.
