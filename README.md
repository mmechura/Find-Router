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

Architektura a vědomá omezení (přesnost převýšení, rozpoznávání intervalů,
odhad tempa) jsou popsané v [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

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

1. Klikni na **Připojit Strava** a projdi OAuth souhlas.
2. Nastav datum tréninku (musí mít v intervals.icu naplánovaný event typu
   *Workout*) a výchozí bod (ručně nebo tlačítkem *Použít moji polohu*).
3. Klikni **Vygenerovat trasu** → appka spočítá trasu a nabídne odkaz
   **Otevřít v Mapy.com a exportovat GPX**.
4. V Mapy.com trasu zkontroluj/doladíš a exportuješ GPX nativně přes jejich
   plánovač, pak nahraješ do Garmin Edge.
5. Pokud appka rozpoznala intervaly, přibude sekce **"Okruh na intervaly"**
   s vlastním odkazem do Mapy.com — tenhle kratší okruh je určený k
   opakování na místě, ne k proběhnutí jednou.

## Nasazení (aby appka fungovala odkudkoli, ne jen na `localhost`)

Appka je dockerizovaná a má připravený `render.yaml`, takže nejrychlejší cesta
je [Render.com](https://render.com) (má fungující free tier). Nemám k tvému
Render účtu přístup, takže tohle je potřeba proklikat ručně — je to ale
prakticky jednorázová záležitost:

1. Založ si účet na render.com a propoj ho se svým GitHub účtem.
2. **New +** → **Blueprint** → vyber repozitář `mmechura/Find-Router` a
   branch. Render najde `render.yaml` a připraví službu automaticky
   (`runtime: docker`).
3. Při vytváření vyplň proměnné prostředí: `APP_PASSWORD` (vymysli si silné
   heslo — chrání to appku i tvoje API klíče, appka nemá vlastní účty),
   `MAPY_API_KEY`, `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`,
   `INTERVALS_API_KEY`, `INTERVALS_ATHLETE_ID`. `STRAVA_REDIRECT_URI` zatím
   nech prázdné/placeholder — vyplníš ho v kroku 5.
4. Deploy. Render ti přidělí veřejnou adresu typu
   `https://find-router-xxxx.onrender.com`.
5. Nastav `STRAVA_REDIRECT_URI=https://find-router-xxxx.onrender.com/auth/strava/callback`
   (proměnná prostředí v Render → uloží se, appka se restartuje) a stejnou
   doménu (bez `https://` a bez cesty) přidej do Strava aplikace jako
   *Authorization Callback Domain* na <https://www.strava.com/settings/api>.
6. Otevři appku na veřejné adrese (přihlásíš se heslem z `APP_PASSWORD`),
   klikni **Připojit Strava**. Po odsouhlasení appka zobrazí **refresh
   token** — zkopíruj ho do proměnné prostředí `STRAVA_REFRESH_TOKEN` v
   Render (bez toho appka nemá trvalý disk, takže by po každém uspání
   ztratila spojení a musela by ses přihlašovat ke Stravě znovu).

Od téhle chvíle appka na Render URL přežije restart i redeploy bez nutnosti
cokoliv znovu propojovat. Jediná daň za free tier: služba po ~15 minutách
nečinnosti "usne" a první request po probuzení trvá desítky sekund — pokud
ti to vadí, přejdi na placený plán, appka na tom nic nemění.

### Alternativa: vlastní/jiný hosting

`Dockerfile` je běžný dvoufázový Node build (`docker build -t find-router .`
a `docker run -p 3000:3000 --env-file .env find-router`), takže jde stejně
snadno nasadit na Fly.io, Railway, vlastní VPS apod. — jen pohlídej, že
`STRAVA_REDIRECT_URI` odpovídá veřejné doméně a že máš nastavené proměnné
prostředí ze sekce Instalace výše (+ `APP_PASSWORD`).

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
