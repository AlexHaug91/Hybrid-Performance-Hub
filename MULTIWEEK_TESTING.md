# Milepæl 9: programmer, sammenleggbare kort og kortvarianter

Arbeidsbranch: `feature/multiweek-programs-ux-v5`. Utgangspunkt: main `c01f1c45ab006f1e5775542c0acfe8e3526cc2a4`. Arbeidet skal gjennomgås før commit eller publisering.

Synlig appversjon er fortsatt **4.1.0**. JSON bruker fortsatt **versjon 1**, og eksisterende lagrings-, språk-, kladd-, import- og gjenopprettingsnøkler er beholdt. Det gjøres ingen omskriving eller migrering av treningsdata ved oppstart.

## Hvordan programmene fungerer

Programbyggeren finnes på Plan. Velg navn, mål, beskrivelse, startdato, 6/8/12 uker, ønsket antall økter per uke og eventuell konkurransedato. Velg eksisterende maler og fyll tomme uker, eller bygg ukene enkeltvis. Ingen progresjon, vekter eller treningsfaser legges inn automatisk.

Programuker er sammenhengende syvdagersperioder fra valgt startdato. Hvis programmet starter på fredag, går programuke 1 fra fredag til torsdag. Dagsvalgene viser de faktiske datoene og ukedagene. Datoene beregnes med kalenderdager, ikke ved å legge til 24 timer i millisekunder; årsskifter og sommer-/vintertid er testet.

Programmer lagres som det valgfrie feltet `data.programs`. Hvert program har:

- En stabil `program-…`-ID, navn, beskrivelse, mål, startdato, lengde og antall økter per uke.
- Valgfri konkurransedato, aktiv-/arkivstatus og valg om faste økter skal vises parallelt.
- `weeks` med egne ukefokus, restitusjonsmarkeringer, hviledager og eventuelle kopier for å angre restitusjonsendringer.
- `sessions` med unike `program-occ-…`-ID-er, referanse til opprinnelig øktmal, programuke, dag og en selvstendig kopi av hele øktoppsettet.

Øktforekomstens plan er en kopi, ikke en levende kobling til dagens mal. Flytting endrer ikke ID. Ukekopiering lager nye forekomst-ID-er, og kopierte planer kan endres uavhengig. Fjerning beholder forekomsten som `retired`, slik at tidligere logger og kladder fortsatt har gyldige referanser. Uker med påbegynte økter kan ikke erstattes gjennom ukekopiering; bruk en annen uke eller et eksplisitt tillegg.

Lengden velges før økter legges inn. Et utfylt program skifter ikke mellom 6/8/12 uker; opprett et nytt program for en annen lengde. Dette unngår at eksisterende uker og forekomster fjernes utilsiktet.

## Samspill med dagens faste plan

Et lagret program er i utgangspunktet inaktivt. Eksisterende ukeplaner og `weekPlans` endres ikke ved opprettelse.

Ved aktivering velger brukeren om faste økter skal vises parallelt eller skjules midlertidig i perioden. Eksisterende globale ekstraøkter beholdes. Hvis en programøkt og en fast forekomst bruker samme mal på samme dato, vises programforekomsten i stedet for å lage en utilsiktet dobbeloppføring. Bevisst tilføyde ekstraøkter beholder egne ID-er, også flere av samme type samme dag.

Flere programmer kan lagres. Ikke-overlappende programmer kan være aktive samtidig. Ved overlapp må brukeren bekrefte at andre overlappende programmer deaktiveres, eller avbryte aktiveringen. Programmer med overlappende perioder aktiveres ikke parallelt.

Deaktivering og arkivering sletter ikke øktmaler, logger, programplaner eller kladder. Den faste planen vises igjen når programmet ikke gjelder for datoen. Avsluttet periode er en avledet visning; appen skriver ikke nye statusverdier ved oppstart.

Nye økter kan opprettes direkte fra programbyggeren gjennom de eksisterende byggerne. Disse nye malene får det valgfrie feltet `programOnly: true` og vises i et eget malbibliotek, uten å bli lagt til den faste ukeplanen automatisk. De kan fortsatt redigeres, loggføres, arkiveres og gjenopprettes. En aktiv programforekomst bruker sin beholdte kopi selv om originalmalen arkiveres.

## Progresjon, restitusjon og historikk

«Øktoppsett» åpner den eksisterende byggeren for den valgte programkopien. Velg mellom bare denne forekomsten og denne/senere upåbegynte forekomster av samme mal. Sett, repetisjoner, belastning, distanse, tid, fart, antall intervaller og HYROX-runder redigeres gjennom de samme kontrollene som tidligere.

«Originalmal» er en separat handling med tydelig beskjed om at den faste malen redigeres. Programkopier og historikk følger ikke slike malendringer automatisk.

En restitusjonsuke markeres eksplisitt. Brukeren reduserer volum, intensitet eller begge deler manuelt i øktoppsettene. «Angre restitusjonsendringer» gjenoppretter de beholdte førverdiene for upåbegynte forekomster. Påbegynte logger og kladder beholdes. Hviledager hopper over upåbegynte planlagte økter etter bekreftelse og kan oppheves igjen.

Programlogger og kladder får valgfrie `programContext`-data: program-ID, forekomst-ID, programnavn, programuke og en kopi av planverdiene ved registrering. Faktiske resultater ligger fortsatt i logger og sett/stasjoner som før. Senere programendringer erstatter ikke disse øktsnapshotene.

Ved flytting av startdato får påbegynte forekomster en beholdt `pinnedDate`. Logger og kladder blir på sin opprinnelige dato; bare upåbegynte forekomster flyttes. Påbegynte forekomster kan ikke flyttes eller få nye planverdier gjennom programbyggeren. Faktiske resultater redigeres fra historikken med riktig logg-ID.

Programendringer er utkast frem til «Lagre program». Lagringsfeil beholder det åpne utkastet og den sist lagrede versjonen. Ulagrede programendringer gir et nettleservarsel ved avslutning der nettleseren støtter dette, og blokkerer kontrollert PWA-oppdatering. Import krever at åpne program- og kortforslag lagres eller lukkes først.

## Sammenleggbare kort og navn

Styrkeøvelser og individuelle HYROX-deler har en pil til høyre, `aria-expanded`, tilknyttet detaljområde og en smal fremdriftslinje. De kan foldes ved 0/4, 2/4 og 4/4. Hoppede sett teller ikke som utført. Flere kort kan være åpne samtidig, og HYROX-runder kan foldes uavhengig av delene.

Visningstilstanden finnes bare i minnet. Den er knyttet til logg-/forekomstnøkkelen og stabil delidentitet eller innholdsidentitet, med egen identitet for ellers identiske deler. Den beholdes ved omtegning, navigasjon og lagring i samme åpne app. Ved første lagring videreføres tilstanden til den nye historiske logg-ID-en. Full omlasting gir en ny standardvisning; treningsverdier og kladder beholdes gjennom eksisterende lagring.

Åpning/lukking skriver ikke treningsdata, endrer ikke utført-/hoppet-over-flagg og legger ikke til felter i JSON. Fokus og markering forsøkes videreført når en nødvendig omtegning erstatter et aktivt felt.

Visningsnavnene er nå «Styrke», «Intervaller» og «HYROX», på engelsk «Strength», «Intervals» og «HYROX». De interne verdiene er fortsatt `mixed`, `interval` og `hyrox_rounds`. Brukerens egne titler og kommentarer oversettes ikke.

## «Jeg har bare 30 minutter»

Åpne en planlagt, uregistrert økt og velg knappen. Forslaget viser opprinnelig dosering og hvilke deler/sett som beholdes. Brukeren kan justere antall sett og velge deler før en eksplisitt bekreftelse. Oppvarming og avslutning beholdes som utgangspunkt. Forslaget reduserer mengde; **30 minutter er et mål, ikke en tidsberegning eller garanti**.

Kortvarianten endrer bare den aktuelle registreringen. Verken originalmalen eller resten av programmet skrives om. Valgfrie `variant`-data lagrer:

- `kind: "shortened"` og målet 30 minutter.
- En kopi av den opprinnelige planen.
- Hvilke opprinnelige deler og sett brukeren valgte å beholde.

Bare de valgte delene inngår i variantens registrering. Bortvalgte deler blir ikke markert utført. HYROX-varianten beholder bare valgte runder og korrekte mellompauser, og gjentatt distanse beholder distanse per drag adskilt fra den nye totaldistansen. Historikk og fullføringsmeldinger merker økten som forkortet. Delvis lagring, Fortsett, omstart og JSON støtter varianten.

Et nytt kortforslag velges før resultater registreres. Appen avviser ny forkorting av en eksisterende historisk logg eller en registrering som allerede inneholder inntastede resultater. Dette hindrer at faktisk gjennomførte deler fjernes. En allerede opprettet kortvariant kan fortsatt lagres delvis og fortsettes normalt.

Hvis kladdlagring feiler ved bruk av forslaget, beholdes både forslaget og originalregistreringen. Ingen vellykket lagring påstås. Brukeren kan forsøke igjen.

## JSON, offline og tidligere versjoner

Alle nye felter er valgfrie tillegg til JSON-versjon 1. Gamle sikkerhetskopier støttes fortsatt. Programreferanser, interne ID-er, gyldige datoer, forekomster, øktsnapshots, recovery-kopier og kortvarianter valideres før import. Eksisterende importjournal og gjenopprettingskopi brukes fortsatt; det er ikke innført en egen parallell importmekanisme.

**Bruk den nye versjonen til sikkerhetskopier med programdata og kortvarianter.** En eldre publisert app kan avvise disse filene eller ikke forstå de nye feltene. At en eldre app eventuelt godtar filen betyr ikke at den kan vise eller bevare programfunksjonene korrekt.

Appkoden er fortsatt inline i HTML. De samme syv appressursene caches, og service-worker-scope er fortsatt `/Hybrid-Performance-Hub/`. Intern ressursrelease er oppdatert koordinert i HTML, `pwa.js` og `sw.js`; synlig versjon er uendret. Nye program-/kortutkast inngår i oppdateringsbarrieren. Førstegangsveiledningen for installert PWA gjenkjenner også et lager som bare inneholder programmer.

Første offline-klargjøring krever nett. Test på en isolert HTTPS-origin og eksporter kopi før bruk av ekte historikk. Safari og installert iPhone-PWA kan ha separate lokale lagre. Ingen skysynkronisering eller automatisk dataoverføring er innført.

## Automatiserte kontroller

Siste komplette kjøring: **550 av 550 automatiserte tester bestod** (476 eksisterende og 74 nye). **Alle 14 Chromium-testskript bestod** (12 eksisterende og 2 nye). `git diff --check` var uten feil.

- `node --test tests/*.test.cjs`
- `PYTHONDONTWRITEBYTECODE=1 python3 tests/browser-multiweek-programs.py`
- `PYTHONDONTWRITEBYTECODE=1 python3 tests/browser-logging-cards-shortened.py`
- Alle tolv tidligere `tests/browser-*.py`-skript kjøres også.

Ingen tidligere tester er fjernet. Den eksisterende HYROX-nettlesertestens forventning til byggetypens overskrift er oppdatert fra «HYROX Rounds» til den nye presise teksten «HYROX»; samme scenario og datakontroller er beholdt.

De nye testene dekker faktisk Playwright-frakobling, omstart, import og lagringsfeil ved 320, 375, 393 og 1280 piksler. Datoer prøves også med Europe/Oslo-tidssone og over sommer-/vintertid. Separate nettleserkontekster simulerer PWA-lagre; fysisk iPhone er fortsatt en manuell kontroll.

## Kort manuell testliste for PC og fysisk iPhone

1. Opprett ett 6-, ett 8- og ett 12-ukers program. Velg forskjellige startdager, mål og økter. Kontroller ukeoversikt, neste uke og Dagens økt. Programnavn og egne ukefokus skal være uendret ved språkbytte.
2. Fyll tomme uker og legg til en ekstraøkt. Kopier en uke til en tom uke og prøv bevisst erstatning av en upåbegynt uke. Flytt en økt mellom uker og til søndag. Prøv to av samme økt på samme dato.
3. Endre én forekomst, senere forekomster av samme mal og originalmalen via hver sin handling. Prøv styrkeprogresjon, flere intervaller og endret antall HYROX-runder. Påbegynt historikk skal bestå.
4. Marker restitusjonsuke, reduser sett/vekt manuelt og angre. Marker en hviledag, avbryt først og bekreft deretter. Opphev hviledagen og kontroller at tidligere manuelt hoppede økter ikke aktiveres utilsiktet.
5. Aktiver med faste økter skjult og med parallell visning. En identisk fast økt på samme dato skal ikke dukke opp dobbelt. Prøv overlappende programperioder, avbryt og bekreft erstatning. Deaktiver/arkiver og kontroller den opprinnelige faste planen.
6. Start en programøkt, registrer resultater og lagre delvis. Flytt programmets startdato og kontroller at denne loggen/kladden fortsatt har sin opprinnelige dato og ID. Fortsett fra Dagens økt og historikken.
7. Fold styrkekort ved 0/4, 2/4 og 4/4, åpne igjen, og hold flere åpne. Fold en HYROX-del og en hel runde uavhengig. Prøv piltast/Enter/Space, VoiceOver, større tekst og tastatur på fysisk iPhone. Ingen registrerte verdier skal endres av folding.
8. Prøv 30-minuttersforslag for alle tre byggetyper. Sammenlign med originalen, endre antall/beholdte deler, avbryt, og bekreft et nytt forslag. Lagre delvis, start appen på nytt, fortsett og fullfør. Historikken skal si «Forkortet økt».
9. Vent på «Offline-filer klare», bruk flymodus og gjenta programredigering, dagens økt, folding og kortvariant. Prøv både Safari og installert app, separat.
10. Eksporter testdata med programmer, HYROX, intervaller, kortvariant og kladd. Avvis import først, importer deretter, og kontroller gjenopprettingskopien. Prøv en eldre JSON-fil. Simuler full/blokkert lagring på PC og kontroller beholdt innhold, tydelig feil og nytt forsøk.

Fysisk iOS-tastatur, VoiceOver, appavslutning av operativsystemet og faktisk Safari/PWA-lagringsdeling kan ikke bekreftes av Chromium-testene. Lagre programutkast før appen lukkes; nettlesere garanterer ikke avslutningsvarsler på mobil.
