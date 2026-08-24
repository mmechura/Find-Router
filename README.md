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
   Garmin Connect/Express → **Garmin Edge**.

Architektura a vědomá omezení (přesnost převýšení, strukturované intervaly,
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

## Vývoj

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest — jádro algoritmu je testované s mockovaným
                     # Mapy.com klientem, žádné síťové volání není potřeba
```

## Bezpečnost / soukromí

- Strava OAuth tokeny se ukládají lokálně do `data/strava-tokens.json`
  (mimo git) — appka je stavěná jako jednouživatelský lokální nástroj, ne
  jako veřejně nasazená služba. Pro nasazení mimo `localhost` doplň
  pořádnou session/token správu a HTTPS.
- Mapy.com API klíč zůstává jen na serveru (volání Routing API i sestavení
  odkazu do plánovače dělá backend); do prohlížeče jde jen informace, jestli
  je nastavený. Neházej ho nikam do veřejného repozitáře.
