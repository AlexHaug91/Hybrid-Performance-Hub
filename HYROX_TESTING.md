# HYROX-runder: datamodell og manuell kontroll

Arbeidet ligger lokalt på `feature/hyrox-round-builder-v5`, basert på main `fc0fd8ee74a79f3df6149b1f032caef49b252438`. Synlig versjonsmerke og alle eksisterende lagringsnøkler er uendret.

## Data og kompatibilitet

- En ny mal har `mode: "hyrox_rounds"` og `hyroxRounds: {rounds: [{id}], restSeconds}`. Antall runder er 1–10.
- Malens eksisterende `exercises`-liste beholdes som ordnet liste. Hver del har et eget `hyrox`-objekt med stabil `partId`, `roundId`, `section` (`before`, `round`, `after`), `station`, `customName` og `plan`.
- Planen bruker meter, hele sekunder, repetisjoner og kg. `distanceUnit` og `speedUnit` styrer visningen; `speedKmh` er kanonisk fart. `loadBasis` er `per_hand` for Farmers Carry og `total` for øvrige belastninger. `sets` støtter styrke og egendefinerte stasjoner.
- En logg har sin egen `hyroxRounds`-kopi og egne kopier av hver dels plan og identitet. `kind: "hyrox"` skiller disse resultatene fra eldre sett og intervaller. Hvert sett lagrer `hyroxActual: {meters, seconds, reps, kg, note}` ved siden av eksisterende fullført-/hoppet over-flagg. Tomme resultater er `null`, ikke tallet 0 eller verdier som påstås gjennomført.
- Kladden bruker `hyroxInput` med fem tekstfelt, slik at blant annet uferdig `5:` og kommentarer overlever omstart. Kladdnøklene og koblingen til logg-ID og occurrence-ID er de eksisterende.
- Planlagte pauser opprettes som egne loggdeler mellom rundene, aldri etter siste runde. Registrerte pauser summeres separat fra registrerte arbeidsdeltider. Den eventuelle overordnede øktvarigheten legges ikke til disse summene.
- Kopiering av en hel økt eller runde gir nye runde-/del-ID-er. Historikk og kladder kopieres ikke til en ny øktmal.
- Eldre økter konverteres ikke. Eksisterende maler, historikk, standardmaler og JSON-versjon 1 beholdes. Importvalideringen kontrollerer både gamle og nye data før eksisterende import-/gjenopprettingsmekanisme brukes.
- Nye sikkerhetskopier med HYROX-runder krever en appversjon som støtter denne byggetypen. Den eldre publiserte appen kan avvise slike filer; gamle sikkerhetskopier støttes fortsatt i den nye appen.

## PC og fysisk iPhone

Bruk en isolert HTTPS-testadresse for fysisk telefon, uten å publisere main eller erstatte produksjonsappen. Se også `PWA_TESTING.md`. Eksporter en kopi av eventuelle ekte treningsdata før testing.

1. Opprett «Ny økt» og velg «HYROX-runder». Prøv både en tom runde og hurtigmalen med fire runder. Kontroller navn, søndag som treningsdag, sted, fokus og beskrivelse.
2. Legg til løping, SkiErg/Row, Wall Balls, Farmers Carry og styrke i samme runde. Prøv meter/kilometer, tid som `90` og `1:30`, fart i km/t og tempo som `5:30`. Kontroller at Farmers Carry viser kg per hånd.
3. Kopier og flytt en runde. Endre kun kopien. Kopier/flytt/slett deler, avvis en sletting og bekreft en annen. Kontroller at originalen er uendret.
4. Legg til oppvarming før rundene, pause mellom rundene og nedjogging etterpå. Start via Dagens økt. Åpne/lukk runder, skriv faktiske resultater og kommentarer. Ingen del skal markeres utført ved forhåndsutfylling.
5. Fullfør tre av fire runder og lagre delvis. Kontroller at fjerde runde fortsatt er der. Se rundetider og faktiske distanser; manglende tid skal vises som manglende. Kontroller at pauser og overordnet øktvarighet ikke dobbelttelles.
6. Skriv `5:` i et tidsfelt, bytt fane og last siden på nytt. Gjenåpne riktig kladd, fullfør tiden og lagre. Ugyldig tid skal stoppe lagring uten å slette felt eller tidligere logg.
7. Planlegg to ekstra forekomster av samme økt samme dag. Start begge og gi dem ulike kommentarer. Kontroller separate kladder, logger og Fortsett-knapper.
8. Rediger malen etter logging. Arkiver den, åpne/rediger gammel logg, og gjenopprett malen på en annen dag. Tidligere øvelser, runder, enheter og resultater skal bestå.
9. Bytt norsk/engelsk i byggeren og under logging. Egen tittel, navn og kommentarer skal ikke oversettes. Prøv VoiceOver, fokus, større skrift, liggende visning og tastaturet på fysisk iPhone.
10. Vent på «Offline-filer klare», slå på flymodus og opprett/loggfør/lagre en HYROX-økt. Lukk og åpne appen igjen offline. Kontroller også den installerte iPhone-appen separat fra Safari.
11. Eksporter JSON med både logg og kladd. Avvis en import først, importer deretter testkopien og kontroller alt. Prøv også en eldre sikkerhetskopi og nedlasting av gjenopprettingskopien.
12. På PC: simuler blokkert/full lagring og kontroller tydelig feil, beholdt innhold og vellykket nytt forsøk. Test en ventende PWA-oppdatering med aktiv HYROX-kladd og med åpen bygger.

## Automatisering

- `node --test tests/*.test.cjs`
- `PYTHONDONTWRITEBYTECODE=1 python3 tests/browser-hyrox-round-builder.py`
- Alle ti tidligere Chromium-skript kjøres også.

Den nye nettlesertesten bruker ekte Playwright-frakobling og visninger på 1280, 320, 375 og 393 piksler. Den kan ikke bekrefte fysisk iPhone-tastatur, VoiceOver, iOS-lagringspartisjonering eller OS-avslutning av en installert PWA.

HYROX-koden er inline i HTML. Ingen nye cachede filer er nødvendige. Intern ressursrelease er økt samlet i HTML, `pwa.js` og `sw.js`; dette endrer ikke synlig appversjon. Den eksisterende PWA-testen leser nå startrelease fra service workeren, men beholder alle tidligere kontroller og feilscenarioer.

## Tillegg: øvelsesvelger og bytte av stasjon

Den eksisterende native nedtrekksmenyen ved «Legg til del» er gjenbrukt. Den tilbyr alle elleve øvelsestyper, inkludert «Annen styrkeøvelse» og «Egendefinert øvelse». Hver eksisterende del har nå også et eget øvelsesvalg. Samme øvelse kan legges til flere ganger med ulike del-ID-er.

Burpee Broad Jumps og Sandbag Lunges støtter nå både distanse og repetisjoner. Wall Balls viser ballvekt, Sandbag Lunges viser sandsekkvekt, og Farmers Carry viser fortsatt vekt per hånd. Alle målefeltene for egendefinerte øvelser er valgfrie.

Ved bytte beholdes del-ID, runde-ID, eget navn og kompatible planverdier. Hvis byttet vil fjerne planverdier, ugyldig påbegynt inntasting eller flere planlagte sett, viser appen hvilke verdier som fjernes og krever bekreftelse. Avbryt lar både modellen og nedtrekksvalget stå uendret. Vekt per hånd og totalvekt omregnes aldri. Lagrede logger og kladder beholder sine opprinnelige øvelsesdata. Forrige-resultat-visningen sammenligner også stasjonstype og belastningsbetydning, slik at et resultat fra en annen stasjon ikke vises som sammenlignbart etter øvelsesbytte.

Test spesielt på fysisk iPhone:

1. Velg hver av de elleve øvelsene fra menyen og kontroller de relevante feltene. Velg samme øvelse to ganger, kopier og flytt en del.
2. Fyll inn distanse, tid og fart på Løping. Bytt til Row, avbryt tap av fartsmålet, og kontroller at alt står uendret. Godta deretter byttet og kontroller at felles distanse/tid består.
3. Skriv 24 kg per hånd på Farmers Carry og bytt til Sled Push. Avbryt først. Godta deretter og kontroller at totalbelastningen er tom; den skal ikke bli 24 eller 48 kg automatisk.
4. Prøv repetisjoner på Burpee Broad Jumps og Sandbag Lunges. Loggfør, lagre delvis, åpne igjen og eksporter/importer JSON.
5. Bytt type på en mal som har både historisk logg og kladd. Kontroller at gammel logg og kladd fortsatt viser den opprinnelige stasjonen og resultatene.
6. Gjenta med engelsk språk og flymodus. Brukerens egne navn skal være uendret.

Nye tester: `tests/hyrox-exercise-picker.test.cjs` og `tests/browser-hyrox-exercise-picker.py`. Ingen tidligere tester er fjernet eller svekket. Den interne ressursreleasen er økt til `hyrox-rounds-20261127-2`; synlig versjon og lagringsformat er uendret.
