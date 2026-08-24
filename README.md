# Find-Router

Osobní nástroj, který ti vygeneruje trasu na dnešní trénink:

1. přečte **plánovaný trénink** z [intervals.icu](https://intervals.icu)
   (typ, vzdálenost/čas, poznámky),
2. přečte tvůj **aktuální stav** z [Strava](https://www.strava.com) (poslední
   4 týdny aktivit → jednoduchý odhad únavy a tvého průměrného tempa),
3. z výchozího bodu vygeneruje **okružní trasu** odpovídající délky pomocí
   [Mapy.com REST Routing API](https://developer.mapy.com/),
4. dá ti odkaz, který otevře tu samou trasu přímo v **plánovači Mapy.com**,
   kde ji doladíš a použiješ jejich vlastní **Export → GPX** →
   Garmin Connect/Express → **Garmin Edge**,
5. pokud trénink obsahuje intervaly (rozpozná je z popisu, např. "6x1km
   (400m klus)"), vygeneruje navíc **krátký opakovací okruh** přesně na
   délku jednoho úseku + zotavení — misto aby cpala všechna opakování do
   jedné dlouhé trasy (GPX stejně nenese tempo/zóny, to řeší intervals.icu
   -> Garmin Connect strukturovaným tréninkem samostatně).

U kola si vybereš **silnice / gravel** (mění se tím povolený povrch, ne
sklon terénu) a appka body okruhu staví chytřeji, ne jen náhodně:
- každý bod se přichytí k **reálné silnici/cestě** (živě přes OSM/Overpass),
- appka aktivně vyhýbá **slepým výběžkům**, **zakázaným oblastem**
  (soukromé/oplocené areály — živě přes OSM) i **silnicím jen pro auta**
  (dálnice, rychlostní silnice, `bicycle=no` — u kola),
- **sklon trasy se ověřuje** proti Mapy.com Elevation API — rozcvička a
  vyklusání dostanou vždycky přísný limit na sklon, i když je zbytek
  tréninku záměrně kopcovitý,
- **průměrná rychlost** je editovatelné pole (předvyplněné ze Strava
  historie nebo výchozí hodnotou appky) — mění cílovou vzdálenost i
  rozdělení rozcvička/vyklusání okamžitě, jak ji měníš,
- **terén** (rovina/kopce) si můžeš vybrat i ručně — appka jinak sama
  volí rovinu jen u opravdu volných/regeneračních tréninků.

Appka umí i vykreslit tvoje poslední trasy ze Strava na mapu (panel
"Moje trasy (Strava)") — není to oficiální Strava heatmapa (tu appka přes
běžný API klíč nemá jak stáhnout), jen přehled, kudy už jsi jezdil/běhal,
postavený ze stejných dat, co appka používá pro odhad tempa a únavy.

Podrobnosti, limity a proč to (zatím) není plnohodnotný graf-based
route-planner jsou v [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Proč Mapy.com

Mapy.com má veřejné REST API s reálným routovacím enginem (profily pro chůzi,
turistiku, silniční i horské kolo, až 15 waypointů na dotaz) a plánovač tras
s nativním exportem do GPX — přesně to, co tahle appka potřebuje. Appka sama
žádný GPX negeneruje, jen postaví trasu a předá ji do Mapy.com přes odkaz
tvaru `https://mapy.com/fnc/v1/route?start=...&end=...&waypoints=...`, aby se
export nemusel duplikovat.

## Požadavky

- Node.js 18.17+
- API klíč pro Mapy.com — [developer.mapy.com](https://developer.mapy.com/)
  (založit projekt, vygenerovat klíč)
- OAuth aplikace na Strava — <https://www.strava.com/settings/api>
  (Client ID + Client Secret)
- API klíč pro intervals.icu — v appce *Settings → Developer Settings →
  API Key*, plus tvoje `athlete ID` (vidíš ho v URL, např. `i123456`)

## Instalace

```bash
npm install
cp .env.example .env
# vyplň MAPY_API_KEY, STRAVA_CLIENT_ID/SECRET, INTERVALS_API_KEY/ATHLETE_ID
npm run dev
```

Appka poběží na `http://localhost:3000`.

Appka má hamburger menu (ikonka vlevo nahoře) se 4 sekcemi: **Nová trasa**,
**Kalendář tréninků**, **Archiv tras** a **Nastavení** (tam je teď přesunuté
připojení Strava).

1. V **Nastavení** klikni na **Připojit Strava** a projdi OAuth souhlas.
2. V **Kalendáři tréninků** vidíš nejbližší dva týdny z intervals.icu —
   klikni na trénink a datum se ti vyplní samo (nebo si celý kalendář
   stáhni jako **.ics** a importuj do Google/Apple/Outlook kalendáře).
3. Zadej výchozí bod buď **adresou** (napiš a klikni *Najít*, appka ji přes
   Mapy.com geocoding převede na souřadnice) nebo přímo lat/lon, případně
   tlačítkem *Použít moji polohu*.
4. Jakmile appka zná datum i start, dopočítá náhled v sekci **"Přepočet
   podle rychlosti"** — cílovou vzdálenost, rozcvičku/vyklusání, velikost
   opakovacího okruhu. Pole **"Průměrná rychlost"** je předvyplněné (ze
   Strava historie nebo výchozí hodnotou appky), ale klidně si ho over-typuj
   — přepočet se aktualizuje za běhu.
5. Klikni **Vygenerovat trasu** → appka spočítá trasu a nabídne odkaz
   **Otevřít v Mapy.com a exportovat GPX**.
6. V Mapy.com trasu zkontroluj/doladíš a exportuješ GPX nativně přes jejich
   plánovač, pak nahraješ do Garmin Edge.
7. Pokud appka rozpoznala intervaly, přibude sekce **"Okruh na intervaly"**
   s vlastním odkazem do Mapy.com — tenhle kratší okruh je určený k
   opakování na místě, ne k proběhnutí jednou.
8. Každá vygenerovaná trasa se automaticky uloží do **Archivu tras** — hned
   po vygenerování na to appka i přímo upozorní odkazem "Otevřít v Archivu"
   pod trasou, nebo si Archiv kdykoli otevři z hamburger menu, klikni na
   trénink a appka znovu zobrazí uloženou trasu (mapu i odkaz do Mapy.com)
   bez nového generování. Bez nastaveného Vercel KV (viz Nasazení níže) se
   archiv na serverless hostingu po restartu appky vyprázdní; lokálně/na
   hostingu s trvalým diskem přežije v `data/routes.json`.

## Nasazení (aby appka fungovala odkudkoli, ne jen na `localhost`)

### Vercel

Appka běží jako jedna serverless funkce (`api/index.ts` → Express app z
`src/app.ts`, viz `vercel.json`), takže na Vercelu jde nasadit bez Dockeru.
Nemám k tvému Vercel účtu přístup, takže proklikání je na tobě — je to ale
v podstatě jednorázová věc:

1. Na [vercel.com](https://vercel.com) → **Add New** → **Project** → vyber
   repozitář `mmechura/Find-Router` a branch
   `claude/route-planning-app-maps-pbaaor` (nebo hlavní větev, pokud tam
   změny domergneš). Framework preset nech "Other" — build krok appka
   nepotřebuje.
2. V **Environment Variables** přidej: `APP_PASSWORD` (appka nemá vlastní
   účty, tohle jediné heslo ji chrání i s tvými API klíči), `MAPY_API_KEY`,
   `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `INTERVALS_API_KEY`,
   `INTERVALS_ATHLETE_ID`. `STRAVA_REDIRECT_URI` zatím nech prázdné/cokoliv —
   doplníš ho v kroku 4.
3. Deploy. Vercel přidělí adresu typu `https://find-router-xxxx.vercel.app`.
4. Nastav proměnnou `STRAVA_REDIRECT_URI=https://find-router-xxxx.vercel.app/auth/strava/callback`
   (Project → Settings → Environment Variables → redeploy, aby se projevila)
   a stejnou doménu (bez `https://` a bez cesty) přidej do Strava aplikace
   jako *Authorization Callback Domain* na <https://www.strava.com/settings/api>.
5. Otevři appku na veřejné adrese (přihlásíš se heslem z `APP_PASSWORD`),
   klikni **Připojit Strava**. Po odsouhlasení appka zobrazí **refresh
   token** — zkopíruj ho do proměnné `STRAVA_REFRESH_TOKEN` na Vercelu a
   redeployni. **Tohle je na Vercelu nutné, ne jen doporučené**: serverless
   funkce běží na read-only souborovém systému, appka tam nemá kam uložit
   token lokálně, takže bez `STRAVA_REFRESH_TOKEN` by se Strava po každém
   "studeném startu" odpojila.
6. Stejný problém (read-only disk) má i **Archiv tras** — bez trvalého
   úložiště by se po každém studeném startu vyprázdnil. Appka na to používá
   Upstash Redis (funguje i jako Vercel KV integrace, zdarma na malé
   objemy):
   - Ve Vercel projektu jdi na záložku **Storage** → **Create Database** →
     **Upstash** → **Redis** (nebo rovnou <https://console.upstash.com>,
     pokud chceš databázi spravovat mimo Vercel) a databázi připoj k
     projektu.
   - Upstash/Vercel vygeneruje REST URL a token — zkopíruj je do proměnných
     `ROUTES_KV_REST_API_URL` a `ROUTES_KV_REST_API_TOKEN` (schválně appce
     vlastní jména, ne `KV_REST_API_URL`/`KV_REST_API_TOKEN` ani
     `UPSTASH_REDIS_REST_URL`/`...TOKEN`, které Vercel/Upstash někdy mezi
     verzemi integrace přejmenovávají — appka tak nezávisí na tom, jak se
     zrovna jmenují).
   - Redeploy. Bez těchto dvou proměnných appka archiv jen tiše ukládá do
     `data/routes.json`, což na Vercelu znamená "dokud appka neusne
     studeně" — negeneruje se chyba, jen se archiv nebude spolehlivě
     uchovávat.

Od téhle chvíle appka na Vercel URL přežije redeploy i výpadky bez nutnosti
cokoliv znovu propojovat. Na co si dát pozor: appka pro jednu trasu volá
Mapy.com Routing API vícekrát za sebou — okruh se od základu staví úsek po
úseku (každý úsek = jedno volání, viz "Proč appka nejezdí tam a zpátky"
níže), ne jedním dotazem se všemi waypointy, plus kontrola sklonu přes
Elevation API a případný druhý okruh na intervaly, plus dvakrát Overpass
(zakázané zóny a silniční síť pro přichytávání bodů) — na Hobby plánu s
limitem 10 s na funkci by to při hodně pomalé odezvě některého z těchto
API nebo delší trase (víc úseků) teoreticky mohlo stačit narazit na strop;
kdyby se to dělo, dej vědět, jde to zrychlit (`maxIterations`/
`maxLegRetries` dolů v `loopRouteGenerator.ts`, paralelizace, menší buffer
kolem zón/silnic v `excludedZones.ts`/`roadSnapper.ts`).

### Alternativa: Render / Docker / vlastní hosting

`Dockerfile` + `render.yaml` jsou taky připravené (spouští `dist/server.js`,
tedy klasický dlouho běžící proces, ne serverless funkci) — pro Render
platí stejný postup jako výše, jen v Render → **New +** → **Blueprint**
a proměnné prostředí se nastavují tam. `docker build -t find-router .` a
`docker run -p 3000:3000 --env-file .env find-router` jde stejně snadno
nasadit na Fly.io, Railway, vlastní VPS apod. — na hostingu s trvalým
diskem je `STRAVA_REFRESH_TOKEN` jen volitelná pojistka, appka si tokeny
umí ukládat sama do `data/strava-tokens.json`.

### Volitelné: BRouter routovací engine (Variant 2, Milestone 1)

Appka umí místo Mapy.com pro dotazy **kolo + silnice** použít self-hosted
[BRouter](https://github.com/abrensch/brouter) — engine, který na rozdíl od
Mapy.com umí sám hledat okruh dané délky s ohledem na převýšení (tohle
řeší reálné omezení popsané v [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md):
"Radší rovina" u Mapy.com generátoru v opravdu kopcovitém terénu nešlo
zaručit, jen omezit počtem pokusů). Je to zatím vývojářský přepínač, ne
volba v appce - nastavíš ho přes dvě proměnné prostředí:

```
ROUTE_ENGINE=brouter
BROUTER_URL=<adresa běžící BRouter instance>
```

Detailní návod (lokální vývoj přes `docker compose up brouter`, nasazení
jako samostatná Render free-tier služba, stažení dat pro danou oblast) je
v [`brouter/README.md`](brouter/README.md). Bez nastavení `ROUTE_ENGINE`
(nebo s `ROUTE_ENGINE=mapy`, výchozí) appka běží přesně jako dřív.

## Vývoj

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest — jádro algoritmu je testované s mockovaným
                     # Mapy.com klientem, žádné síťové volání není potřeba
```

## Bezpečnost / soukromí

- Appka nemá vlastní systém účtů — je to jednouživatelský nástroj jen pro
  tebe. Jakmile běží na veřejné adrese, nastav `APP_PASSWORD` (viz
  Nasazení výše): bez něj by k tvým datům a API klíčům měl přístup kdokoli
  s odkazem.
- Lokálně se Strava OAuth tokeny ukládají do `data/strava-tokens.json`
  (mimo git). Na hostingu bez trvalého disku appka místo toho po každém
  startu obnoví přístupový token z `STRAVA_REFRESH_TOKEN`.
- Mapy.com API klíč zůstává jen na serveru (volání Routing API i sestavení
  odkazu do plánovače dělá backend); do prohlížeče jde jen informace, jestli
  je nastavený. Neházej žádný z klíčů/hesel nikam do veřejného repozitáře.
