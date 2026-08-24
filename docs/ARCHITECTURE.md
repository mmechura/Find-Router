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
- `src/routing/polyline.ts` — dekodér Google/Strava "encoded polyline"
  formátu (`summary_polyline`), použitý jen pro `src/routes/heatmap.ts`.
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
- `src/routing/routeStore.ts` — perzistence archivu vygenerovaných tras přes
  rozhraní `RouteStore` (`save`/`list`/`get`) se dvěma implementacemi:
  `FileRouteStore` (lokální `data/routes.json`, pro vývoj a hosting s
  trvalým diskem) a `UpstashRouteStore` (Redis list přes `@upstash/redis`,
  pro Vercel). `getRouteStore()` vybere Upstash, pokud jsou nastavené
  `ROUTES_KV_REST_API_URL`/`ROUTES_KV_REST_API_TOKEN`, jinak spadne na
  soubor — appka na Vercelu bez KV neselže, jen si archiv nepamatuje mezi
  studenými starty.
- `src/routes/archive.ts` — REST endpointy pro archiv (`GET /api/routes` —
  souhrn posledních 50 tras, `GET /api/routes/:id` — detail včetně
  geometrie a odkazu do plánovače) nad `routeStore.ts`. `src/routes/route.ts`
  po každém úspěšném `/generate` uloží výslednou trasu do archivu (chyba
  uložení appku nezastaví, jen se zaloguje).
- `src/app.ts` — sestavení Express aplikace (middleware + routery), bez
  `app.listen()`. `src/server.ts` ho spustí jako klasický proces (lokální
  vývoj, Docker); `api/index.ts` ho místo toho exportuje jako Vercel
  serverless funkci (viz `vercel.json`) — stejný Express app běží na obou.
- `public/index.html`/`app.js`/`style.css` — jednostránková appka rozdělená
  na 4 "views" (`data-view="home|calendar|archive|settings"`), mezi kterými
  přepíná hamburger menu v `app.js` (`showView()` přepíná třídu `.active`,
  žádný router/framework); design používá CSS custom properties v
  `style.css` s automatickým dark-mode variantou (`prefers-color-scheme`).

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
4. **Terén se kvůli intervalům nezplošťuje** — pokud si výslovně nezvolíš
   jinak. Automatický režim volí rovinu jen když má jít o opravdu
   volný/regenerační trénink (vysoká únava ze Strava dat, nebo klíčová
   slova jako "recovery"/"volno" v názvu) — intervalový nebo jinak
   intenzivní trénink je naopak typický případ, kdy je kopcovitější trasa
   v pořádku, nebo přímo žádoucí (kopcové intervaly, zajímavější terén na
   těžký trénink). V UI je navíc přepínač **Terén** (Automaticky / Radši
   rovina / Radši kopce, `terrain` v `BuildRouteOptions`) — zvolíš-li
   výslovně rovinu nebo kopce, přebije to tenhle automatický odhad úplně,
   ať appka dělá cokoli jiného (workoutSteps, readiness).

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
   - **Okruh appka nestaví jedním dotazem se všemi waypointy, ale úsek po
     úseku** (start → bod 1, bod 1 → bod 2, ..., poslední bod → start),
     kde každý úsek je samostatné volání Mapy.com Routing API mezi dvěma
     body (`routeLoopSegmented()` v `loopRouteGenerator.ts`) - stejný
     princip jako trasa "z bodu A do bodu B" (`pointToPointRoute.ts`).
     Důvod: v řídké silniční síti (jedna cesta údolím) by appka jedním
     společným dotazem snadno dostala trasu, která tam i zpátky jede po
     stejné silnici - a to jak lokálně (viz `spurs.ts` níže), tak na
     úrovni celého okruhu, kde by dva vzdálené úseky potichu sdílely
     stejnou cestu, aniž by to lokální kontrola vůbec zachytila. Appka
     proto po každém úseku porovná jeho trasu se všemi už přijatými úseky
     stejného okruhu (`legOverlap.ts`) - pokud se s některým z nich
     překrývá z víc než 30 % délky, zkusí pro tenhle úsek jiný koncový bod
     (znovu s jitterem směru/poloměru), místo aby si nechala ujet celý
     okruh znovu od začátku. Cena: víc volání Mapy.com na jednu trasu (viz
     README → Nasazení, Vercel).
   - **`spurs.ts`'s `findBacktrackSpurs()` zůstává jako doplňková, levná
     kontrola** na spojené trase celého okruhu - chytí i menší "slepou
     uličku" na konci jednoho úseku (např. bod uvízl v opravdové
     cul-de-sac), kterou 30% práh na celý úsek ještě nemusí odchytit.
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
   - **Sklon na úsek nestačí sám o sobě.** Zvlněný terén může mít každý
     jednotlivý úsek pod limitem (žádný segment není "moc strmý"), a
     přesto se přes celou trasu nasčítá pěkné převýšení — přesně tohle
     způsobovalo, že "Radši rovina" na 20km trase klidně vygenerovalo
     trasu s ~450 m převýšením. `checkRouteElevation()` proto vedle
     sklonu na úsek počítá i **celkové převýšení** (součet kladných změn
     nadmořské výšky) a porovnává ho s `STRICT_MAX_GAIN_PER_KM`
     (10 m/km) × délka trasy — ale **jen když je terén nastavený na
     "Radši rovina"** (`gainCeilingFor()` v `route.ts`); u "Radši kopce"
     i automatického režimu, kde appka usoudí, že kopce jsou v pořádku,
     se tenhle strop vůbec nekontroluje.
3. **Rychlost je vstup, ne jen odhad.** UI má editovatelné pole
   "Průměrná rychlost" — appka ho předvyplní tvým průměrem z poslední
   Strava historie (`readiness.recentAvgSpeedKmh`), nebo výchozí hodnotou
   appky, pokud Strava není připojená nebo pro daný sport nemá historii.
   Změna rychlosti přepočítá cílovou vzdálenost, rozdělení
   rozcvička/vyklusání i velikost opakovacího okruhu okamžitě přes
   `POST /api/route/preview` (bez volání Mapy.com/Overpassu — je to čistě
   aritmetika z `planMatcher.ts`, takže je to levné a rychlé i při psaní
   do pole).
   - **Odhadovaný čas trasy taky počítá appka, ne Mapy.com.** Mapy.com
     v odpovědi routing API vrací vlastní odhad doby jízdy/běhu, ale ten
     má napevno zabudovanou rychlost pro daný profil, nesouvisející s
     rychlostí, kterou si zvolíš — to způsobovalo, že appka klidně
     ukázala "111 min" u trasy naplánované a vypočtené na 50minutový
     trénink při 28 km/h (25 km při 28 km/h je ~53 min, ne 111).
     `route.ts` proto po vygenerování trasy přepíše `durationS` vlastním
     výpočtem `estimateDurationS()` (`actualDistanceKm / paceKmh`) —
     stejnou rychlostí, kterou appka použila i pro cílovou vzdálenost,
     takže si čísla navzájem odpovídají.

**Vědomě zjednodušeno oproti "dokonalému" řešení**: appka pořád nestaví
skutečný graf silniční sítě a nehledá v něm okruh (to by bylo o řád víc
práce — stažení a údržba grafu, algoritmus hledání okruhu s omezeními).
Místo toho kombinuje "namíř náhodně, přichyť na silnici, ověř sklon,
zkus znovu, když to nevyjde" — funguje to podstatně líp než čistě náhodné
body, ale pořád to je heuristika s omezeným počtem pokusů (`maxIterations`,
výchozí 8), ne garance. Ukázalo se to i naostro: "Radši rovina" na 25km
trase v Beskydech (Jablunkov) i po vyčerpání všech 8 pokusů vygenerovalo
trasu s 394 m převýšení — namátkové hádání bodů nemá jak *hledat* rovinatější
terén, jen přijmout/odmítnout to, na co náhodou narazí. Řešení téhle
konkrétní meze je varianta 2 níž.

## Varianta 2, Milestone 1: BRouter jako alternativní routovací engine

Namísto stavby vlastního grafu silniční sítě a hledacího algoritmu od nuly
(viz odstavec výš — proto se to dřív odkládalo jako "samostatný, mnohem
větší projekt") appka od Milestone 1 umí použít existující, k tomuhle
přesně určený engine: [BRouter](https://github.com/abrensch/brouter),
self-hosted, open-source. Na rozdíl od Mapy.com Routing API:

- **umí sám hledat okruh dané délky** (`roundTripDistance`) ze zadaného
  bodu — appka mu nemusí navrhovat tvary a iterovat,
- **sklon je součástí hledání, ne dodatečná kontrola** — profil (`.brf`
  soubor) má `uphillcost`/`downhillcost`, takže "vyhni se kopcům" je
  vlastnost samotného hledání trasy, ne filtr až po faktu,
- **zakázané oblasti (`nogos`) taky řeší při hledání** — engine tudy
  prostě nikdy nenavrhne trasu, místo aby appka musela vygenerovanou
  trasu zahodit a zkusit znovu,
- **segmentová data (graf silniční sítě) publikuje BRouter sám**,
  předpočítaná a pravidelně aktualizovaná — appka si jen stáhne dlaždici
  pro danou oblast, nestaví si vlastní pipeline z OSM dat.

**Rozsah Milestone 1** (schválený plán, ne celá varianta 2 najednou):
jen dotazy **kolo + silnice**, jen oblast Beskyd/Jablunkovska (jedna
segmentová dlaždice `E15_N45.rd5`), běží **souběžně** s Mapy.com
generátorem (ne místo něj) za vývojářským přepínačem `ROUTE_ENGINE=brouter`
+ `BROUTER_URL` (`useBRouterFor()` v `src/routes/route.ts`) — pro cokoli
jiného (běh, gravel, jiná oblast) appka pořád použije Mapy.com generátor
beze změny. Ostatní sport/povrch/terén kombinace, plnohodnotný Overpass-based
seznam `nogos`, a případné zrušení Mapy Elevation API kontroly zůstávají
záměrně mimo tenhle milestone.

Praktické důsledky pro tenhle engine (`src/integrations/brouter.ts`,
`src/routing/brouterLoopGenerator.ts`, `brouter/`):

- **`spurs.ts`/`excludedZones.ts` se pro BRouter cestu vůbec nevolají** —
  skutečné hledání v grafu by nemělo produkovat slepé výběžky, a `nogos`
  řeší zakázané oblasti při hledání, ne po faktu.
- **`checkRouteElevation()` (Mapy Elevation API) běží dál, ale jen jako
  pozorovací kontrola** — pokud nesouhlasí s tím, co už BRouter sám
  vyřešil, appka to jen zaloguje (`generateLoopRouteViaBRouter()`), trasu
  nikdy nezahazuje ani nezkouší znovu. Cíl je nasbírat data o tom, jak moc
  si BRouter věřit, než se tahle druhá kontrola případně úplně zruší.
- **Hosting**: appka zůstává na Vercelu beze změny (Strava OAuth, KV
  archiv...) — BRouter potřebuje trvalý proces s daty na disku, což
  serverless funkce neumí, takže běží jako samostatná služba (viz
  [`brouter/README.md`](../brouter/README.md)), volaná přes `BROUTER_URL`.
  Zvolený hosting je Renderova free tier varianta (0 Kč/měsíc) — vědomě
  přijaté riziko: služba po nečinnosti usne a první request po probuzení
  může trvat desítky sekund, přes 10s limit na Vercel Hobby funkci. Pro
  Milestone 1 (vývojářský přepínač, ne uživatelská volba) je to přijatelné;
  než by tahle cesta byla uživatelsky viditelná, potřebuje to buď placenou
  always-on varianty, nebo fallback na Mapy.com generátor při timeoutu.

## Moje trasy (Strava) — ne oficiální heatmapa

Stravina vlastní heatmapa (dlaždice na strava.com/heatmap) není přes
veřejné vývojářské API dostupná — je to buď funkce jen v jejich vlastní
appce/webu, nebo placený enterprise "Global Heatmap" licenční produkt, ne
něco, k čemu by se dal dostat běžný osobní API klíč. Appka místo toho
staví vlastní přiblížení ze stejných dat, která už jednou stahuje pro
`readiness.ts`:

- `GET /api/strava/heatmap` (`src/routes/heatmap.ts`) zavolá
  `StravaClient.listRecentActivities()` (výchozí okno 180 dní, max. 100
  aktivit na stránku — Strava API nestránkuje víc na jedno volání) a z
  pole `map.summary_polyline` každé aktivity dekóduje souřadnice přes
  `decodePolyline()` (`src/routing/polyline.ts` — standardní Google/Strava
  "encoded polyline" formát).
- Tlačítko **"Načíst moje trasy"** v panelu "Moje trasy (Strava)" na
  frontendu si o ně řekne a vykreslí je jako tenké poloprůhledné čáry na
  vlastní mapě (`#heatmap-map`) — ne oficiální heatmapa s hustotou, jen
  překryv tras, které appka zná. Bez připojené Strava appka vrátí jasnou
  chybu místo pádu (`400` s textem, ať se uživatel jde připojit v
  Nastavení).

## Další vědomá omezení

- **Odhad tempa bez Strava historie**: pokud Strava není připojená nebo
  nemá aktivity daného sportu, použije se konzervativní výchozí tempo
  (běh 10 km/h, kolo 25 km/h) — buď automaticky, nebo si ho přepiš v UI.
- **Mapy.com JS/dlaždicová API**: náhledová mapa v prohlížeči používá
  Leaflet (vendorovaný lokálně v `public/vendor/leaflet/`, žádná závislost
  na CDN) s veřejnými OpenStreetMap dlaždicemi (bez API klíče), aby
  fungovala hned "out of the box" — routing a finální export přesto jdou
  přes Mapy.com. Pokud chceš branding Mapy.com i v náhledu, stačí vyměnit
  `L.tileLayer(...)` v `public/app.js` za dlaždicový endpoint Mapy.com dle
  aktuální [developer.mapy.com](https://developer.mapy.com/) dokumentace.
