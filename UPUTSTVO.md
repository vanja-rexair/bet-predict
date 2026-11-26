# NBA predikcije: uputstvo

Aplikacija prati svaki NBA meč, daje verovatnoću pobede, beleži šta se menja pre i tokom meča i uči iz rezultata.
Sve je besplatno: nema naloga, API ključeva ni plaćenih servisa. Specifikacija je u `README.md`.

## Pokretanje

Potreban je [Node.js 24+](https://nodejs.org).

| Šta | Kako |
|---|---|
| Pokretanje | dupli klik na `start.cmd` (ili `npm start`), zatim http://localhost:8787 |
| Prvi put na novom računaru | `npm install`, pa `npm run bootstrap` (oko 45 minuta: istorija i kvote) |
| Provera odmah | `npm run update` |
| Ponovni trening | `npm run train` (traje pola minuta; prvi put oko 6 minuta) |
| Testovi | `npm test` |
| Android APK | `npm run apk` |

## Praćenje kad aplikacija nije otvorena

Mečeve prati **servis**, ne ekran aplikacije. Dok servis radi, zapis se vodi sam.

1. **Na ovom računaru:** `npm run autostart`
   Servis se pokreće pri prijavi na Windows, bez prozora. Računar ne sme da spava dok se igra. Uklanjanje: `npm run autostart:remove`.
2. **Bez računara:** `npm run github` (provera bez slanja: `npm run github -- --proveri`).
   Kod ide u privatan repozitorijum, a javni su samo JSON fajlovi sa prognozama. GitHub proverava mečeve otprilike na sat vremena, da stane u besplatne minute.
   Posle toga računar samo preuzima te podatke, a adresa se sama upisuje u sledeći APK (`npm run apk`).

Koristite samo jedan od ova dva načina kao glavni, jer svaki vodi svoj zapis uspešnosti.

Servis proverava na 2 minuta dok se igra, na 4 minuta u poslednja 2 sata pre meča, inače na 10 do 20 minuta.
Prva prognoza se pamti zauvek i po njoj se boji kartica u Istoriji (zeleno pogodak, crveno promašaj).
Predikcija se **zaključava na početku meča** i više se ne menja. Ako je računar ugašen pre početka, važi poslednja upisana prognoza; meč bez prognoze ne ulazi u zapis uživo.

## Android

1. Prebacite `dist-apk/nba-predikcije.apk` na telefon i instalirajte (dozvolite instalaciju iz nepoznatih izvora).
2. U aplikaciji otvorite podešavanja (gore desno) i upišite adresu koju servis ispiše pri pokretanju, npr. `http://192.168.1.10:8787`, ili Pages adresu.
3. Dozvolite obaveštenja. Telefon i kad je aplikacija zatvorena proverava novosti na oko 15 minuta (toliko Android dozvoljava).

Adresa računara radi dok je telefon na istoj mreži; Windows će pri prvom pokretanju pitati za dozvolu zaštitnog zida.
Servis nema lozinku, pa ga ne otvarajte ka internetu preko rutera. Kroz mrežu se mogu samo čitati predikcije i tražiti nova provera.

## Kako model radi

- **Podaci:** box score od 2013/14 (sportsdataverse), raspored, povrede, sastavi i kvote (ESPN). Nema plaćenih izvora.
- **Karakteristike (44):** Elo i Glicko, OffRtg/DefRtg/NetRtg prilagođeni protivniku, Pace, četiri faktora, odstupanje trojki od proseka,
  forma, B2B, 3 u 4, 4 u 5, minuti ključnih igrača, kilometri, vremenske zone, visina, uticaj i USG% odsutnih igrača, zamena,
  rejting svakog igrača koji se uči iz svakog meča.
- **Modeli:** logistička regresija, stabla po XGBoost postupku (sopstvena implementacija), regresija razlike poena, pa slaganje.
- **Kvote ne utiču na prognozu.** Prikazuju se na kartici i služe za poređenje i papirne opklade.
- **Merenje:** walk-forward; svaki mesec se predviđa modelom treniranim samo na ranijim mečevima.
- **Učenje iz grešaka:** posle svakog meča pomeraju se rejtinzi i ocene igrača, model se redovno ponovo trenira, svaki promašaj dobija analizu,
  a sistematske greške po situacijama i timovima dobijaju korekciju samo ako je dokazano da pomaže.

## Šta iz README-a nije urađeno i zašto

- **Second Spectrum (kilometri i brzina igrača):** nema besplatan izvor; zamenjeno opterećenjem po minutima.
- **Procenat uplata javnosti i profesionalaca:** nema besplatan izvor; zamenjeno pomeranjem kvote od otvaranja.
- **LSTM:** u README-u je opcion; nije dodat.
- **Godine igrača (30+) u opterećenju:** istorijski datumi rođenja nisu u besplatnim podacima, pa se gledaju minuti cele rotacije.
- **Skoro 100% pogodaka:** nije moguće. Kladionice pogađaju favorita u oko 68% mečeva. Uspešnost raste samo biranjem sigurnijih mečeva.

Izvori nisu zvanični NBA servisi i mogu da promene format. Predikcije nisu savet za klađenje.
