# Offline/PWA: testing og vedlikehold

Endringene er ikke publisert. Synlig appversjon er fortsatt 4.1.0, og treningsdata bruker samme nøkler og JSON-format som før.

## Lokal PC-test under riktig undermappe

1. Åpne en terminal i mappen som **inneholder** repository-mappen `Hybrid-Performance-Hub`.
2. Kjør `python3 -m http.server 8000 --bind 127.0.0.1`.
3. Åpne `http://127.0.0.1:8000/Hybrid-Performance-Hub/` i Chrome/Edge. Localhost er et sikkert utviklingsmiljø for service worker; en vanlig LAN-IP over HTTP er det ikke.
4. Vent til statusen viser «Offline-filer klare på denne enheten». «Tilkoblet» alene er ikke tilstrekkelig.
5. Opprett en ekstra økt i dagens uke, start den, registrer noen verdier og la andre sett stå uferdige.
6. Bruk DevTools → Network → Offline. Naviger i alle faner, bytt språk, lagre delvis og eksporter/importer en **testkopi** av JSON.
7. Last siden på nytt, og lukk og åpne en ny fane med samme adresse mens nett er frakoblet. Fortsett kladden og kontroller logger, forekomst-ID og intervallverdier.
8. Koble til igjen. Hvis appfiler er fjernet fra Cache Storage, kan appen klargjøre **egne appfiler** igjen etter en bekreftet nettilkobling. «Sjekk oppdateringer» prøver også dette. Ikke slett nettstedets brukerlagring for å reparere appfiler.

Codex Cloud sin `localhost` er ikke PC-ens localhost. Denne fremgangsmåten gjelder en lokal kopi på PC-en. Fysisk iPhone må ha en egen tilgjengelig HTTPS-adresse som er godkjent for manuell testing; denne oppgaven oppretter ingen slik publisering.

**Isoler testdata:** En annen mappe eller et annet Pages-repository på samme `alexhaug91.github.io` er samme origin og kan dele localStorage med produksjonsappen. Bruk en annen HTTPS-origin/vertsadresse eller en separat nettleserprofil, og eksporter JSON først. Ikke test erstatningsimport mot den eneste kopien av ekte historikk.

## iPhone Safari og installert app: må kontrolleres fysisk

1. Bruk en godkjent, isolert HTTPS-forhåndsvisning som også beholder `/Hybrid-Performance-Hub/` som undermappe. Eksporter en sikkerhetskopi før testing.
2. Åpne i Safari, vent på klare offline-filer, og lag en tydelig merket Safari-testlogg. Eksporter den til Filer.
3. Installer via **Del → Legg til på Hjem-skjerm**. Åpne appikonet med nett første gang og vent på klare offline-filer også der.
4. Les oppstartsveiledningen. Kontroller om Safari-historikken finnes i den installerte appen. iOS-versjoner kan håndtere lagrene forskjellig; det er ingen skysynkronisering eller automatisk overføring i Hybrid.
5. Lag en separat PWA-testlogg. Eksporter fra den installerte appen før eventuell import. Avvis en import først og kontroller at ingenting er erstattet. Godta deretter en testimport og last ned gjenopprettingskopien for å kontrollere de tidligere PWA-dataene.
6. Slå på flymodus, tren/loggfør i appikonet, legg appen i bakgrunnen og åpne den igjen. Kontroller også avslutning og ny åpning offline, språk, kladder og historikk.
7. Test notch/safe area, rulling og tastatur ved logging og i Innstillinger. Test også stående/liggende visning og store tekstinnstillinger.
8. Ved oppdatering: la en kladd stå åpen, velg oppdatering aktivt og kontroller at nøyaktig samme logg/kladd åpnes etterpå. Uferdige andre skjemaer og åpne byggere skal stoppe oppdateringen. Flere åpne Hybrid-vinduer må lukkes før aktivering.

Chromium-testen bruker separate browser contexts og en simulert standalone-markør. Dette verifiserer at appen ikke selv deler, importerer eller overskriver data automatisk. Det verifiserer **ikke** faktisk lagringspartisjonering eller installasjonsdialoger på iOS. Det krever stegene ovenfor på fysisk enhet.

## Android

Åpne en isolert HTTPS-forhåndsvisning i Chrome, vent på offline-filer, og bruk nettleserens installasjonsknapp når den tilbys. Hvis prompt ikke tilbys, bruk Chrome-menyen. Kontroller standalone, ikoner, offline gjenåpning, logger og kladder. Appen viser ikke en installasjonsknapp uten en faktisk tilgjengelig prompt.

## Cache og sikre oppdateringer

- Kun syv eksplisitte appressurser caches: HTML, PWA-kode, manifest og fire PNG-ikoner. Navigasjoner til appens startadresse bruker den kontrollerende workerens HTML.
- Resource-cache bruker en scope-spesifikk prefiks og intern release. Aktiv cache og én kontrollert forrige release beholdes; eldre **egne** cacher kan fjernes. Andre apper/origins, JSON-eksporter og tredjepartsressurser caches ikke.
- Alle nedlastinger og release-markører verifiseres før en installasjon skriver ny cache. Feil under nedlasting/skriving lar tidligere cache være urørt. Det er ingen `skipWaiting` under installasjon.
- Bakgrunnssjekk kan laste ned en ventende oppdatering, men aktivering krever brukerens valg. Byggere, usikrede skjemaer, pågående import eller ubekreftet lagring stopper omstart.
- Før aktivering verifiseres hoveddata mot lagret innhold, kladder skrives/leses tilbake, og økt-ID, kladdnøkkel og aktiv fane legges midlertidig i **sessionStorage** for gjenåpning. Hoveddatabasen overskrives ikke for å få gjennomført en oppdatering.
- Worker sjekker antall åpne Hybrid-vinduer både før og ved aktivering, og krever et kortlivet engangstoken fra samme vindu.
- Nettverksstatus krever et faktisk nettverkskall som service worker ikke besvarer fra cache. Statusen er ikke bevis for at treningsdata er lagret, og betyr aldri skysynkronisering.
- Nye UI-nøkler: `hybrid_pwa_transfer_help_seen` (localStorage) og `hybrid_pwa_update_return` (sessionStorage). Ingen eksisterende trenings-/språk-/importnøkler eller JSON-felter er endret.

### Fremtidige appfil-releaser

Endre den **interne** release-strengen samlet i:

1. `index.html`: `meta[name="hybrid-shell-release"]`.
2. `pwa.js`: `const RELEASE`.
3. `sw.js`: `const RELEASE`.

Dette må gjøres når cachede appfiler endres og skal distribueres. Den interne cache-releasen er uavhengig av det synlige versjonsmerket. Samme release kan gjenbrukes bare når ressursene er byte-identiske; worker nekter å overskrive en annen eksisterende pakke med samme navn. Publisering skal fortsatt godkjennes separat.

## Automatiserte kontroller

- `node --test tests/*.test.cjs`
- `PYTHONDONTWRITEBYTECODE=1 python3 tests/browser-offline-pwa.py`
- Alle ni tidligere `tests/browser-*.py`-skript kjøres i tillegg.

PWA-testen serverer en midlertidig kopi under den faktiske undermappen. Den bruker Playwrights reelle `set_offline(True)`, nye sider offline, ventende releaser, mislykket installasjon, kvotefeil, flere vinduer, kontrollert aktivering, cacheopprydding og separate lagringsmiljøer. Repository-filer endres ikke av oppdateringssimuleringen.

## Praktiske begrensninger

Første åpning krever nett. OS/nettleser kan senere kaste appfiler eller brukerlagring, og PWA er ingen erstatning for JSON-sikkerhetskopier. Ved blokkert/full lagring kan innhold beholdes i den åpne appen, men ikke garanteres etter at OS avslutter den. Hold appen åpen og løs lagringsproblemet før du lukker. iOS garanterer ikke at `beforeunload` kjøres ved avslutning.
