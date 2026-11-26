import { useState, type ReactNode } from 'react';
import type { GameView, Stats } from '../../../engine/src/types.ts';
import { useData } from '../api.ts';
import { int, num, pct, pickTeam } from '../format.ts';
import { Bars, Diverging } from '../components/charts.tsx';
import { Chip, Empty, Loading } from '../components/ui.tsx';

const share = (v: number) => (v < 0.005 ? 'ispod 1%' : pct(v));

function Example({ games, weights }: { games: GameView[]; weights: { name: string; weight: number }[] }) {
  const list = games.filter((g) => g.models?.length);
  const [id, setId] = useState(0);
  const g = list.find((x) => x.id === id) ?? list[0];
  if (!g) return <Empty>Primer će se pojaviti kad se objave naredni mečevi.</Empty>;
  const pick = pickTeam(g);
  const forPick = (p: number) => (g.pick === 'home' ? p : 1 - p);
  return (
    <>
      <label className="field example">Meč
        <select value={g.id} onChange={(e) => setId(Number(e.target.value))}>
          {list.map((x) => <option key={x.id} value={x.id}>{x.away.name} @ {x.home.name}</option>)}
        </select>
      </label>
      <p>Izbor: <strong>{pick.name}</strong>, {pct(g.confidence)}. Šansa za taj tim po svakom modelu:</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Model</th><th className="r">Šansa</th><th className="r">Težina</th></tr></thead>
          <tbody>
            {g.models!.map((m) => <tr key={m.name}><th scope="row">{m.name}</th><td className="r">{pct(forPick(m.p))}</td><td className="r">{pct(weights.find((w) => w.name === m.name)?.weight ?? 0)}</td></tr>)}
            <tr><th scope="row"><strong>Konačno</strong></th><td className="r"><strong>{pct(g.confidence)}</strong></td><td className="r">–</td></tr>
          </tbody>
        </table>
      </div>
      <p className="hint">Šta je najviše uticalo na logističku regresiju i stabla. Duža traka znači veći uticaj.</p>
      <div className="narrow"><Diverging rows={g.factors.map((f) => ({ label: f.group, value: f.value }))} left={g.away.abbr} right={g.home.abbr} /></div>
      {[...g.outHome, ...g.outAway].length > 0 && <p className="hint">Uzete u obzir povrede: {[...g.outHome, ...g.outAway].map((o) => `${o.name} (${o.status.toLowerCase()})`).join(', ')}.</p>}
    </>
  );
}

function Q({ q, open, children }: { q: string; open?: boolean; children: ReactNode }) {
  return <details className="faq" open={open}><summary>{q}</summary><div className="faq-a">{children}</div></details>;
}

export function How() {
  const { data: s, error } = useData<Stats>('stats.json', 300_000);
  const games = useData<{ games: GameView[] }>('today.json', 60_000).data?.games ?? [];
  if (!s?.how) return <Loading error={error} />;
  const { groups, params, weights, games: n } = s.how;
  const sure = s.byConfidence.filter((b) => b.min === 0.75 || b.min === 0.8);
  return (
    <section className="faq-list">
      <h2>Česta pitanja</h2>
      <Q q="Kako se bira ko će pobediti?" open>
        <ol className="steps">
          <li><strong>Skupe se podaci</strong> poznati pre meča: rezultati, statistika, sastav, povrede, raspored i putovanje.</li>
          <li><strong>Izračuna se {params.length} parametara.</strong> Većina poredi domaćina i gosta.</li>
          <li><strong>Pet modela daje svoju šansu.</strong> Učili su na {int(s.trainedOn)} mečeva, a noviji vrede više.</li>
          <li><strong>Šanse se spoje</strong> u jednu, sa težinama naučenim na ranijim mečevima.</li>
          <li><strong>Bira se tim sa više od 50%.</strong> Prva prognoza se pamti, a na početku meča se sve zaključava.</li>
        </ol>
      </Q>
      <Q q="Šta najviše utiče na izbor?">
        <p>Prosečan uticaj svake grupe u poslednjih {int(n)} mečeva. Težine nisu zadate ručno, model ih je naučio.</p>
        <Bars rows={groups.map((g) => ({ label: g.group, value: g.share, text: share(g.share) }))} />
      </Q>
      <Q q="Kako se došlo do procenta za određeni meč?"><Example games={games} weights={weights} /></Q>
      <Q q="Koji se sve parametri koriste?">
        <p>Procenat je udeo parametra u ukupnom uticaju. Slični parametri (na primer Elo i Glicko) dele uticaj između sebe.</p>
        {groups.map((g) => {
          const list = params.filter((p) => p.group === g.group);
          return (
            <details key={g.group} className="param-group">
              <summary>{g.group} <span className="muted">{list.length}, uticaj grupe {share(g.share)}</span></summary>
              <dl>{list.map((p) => <div key={p.key}><dt>{p.label} <span className="muted">{share(p.share)}</span></dt><dd>{p.desc}</dd></div>)}</dl>
            </details>
          );
        })}
      </Q>
      <Q q="Ko je izabrao ove parametre?">
        <p>Polazna lista je iz specifikacije projekta: efikasnost po posedu, četiri faktora, igrači, zamor i putovanje. Zatim se proverava redom kroz vreme: model predviđa mesec koji nije video. Tako je dodat rejting igrača, jer je smanjio grešku i na starijim i na novijim sezonama. Ono što ne pomaže ostaje isključeno.</p>
      </Q>
      <Q q="Da li kvote utiču na prognozu?"><p>Ne. Kvote se prikazuju i služe za predlog uloga i poređenje, ali ne ulaze u prognozu.</p></Q>
      <Q q="Kako se uzimaju u obzir povrede?">
        <p>Igrač koji ne igra se izbacuje, a njegove minute preuzimaju ostali ili igrač zamenskog nivoa. Neizvesnom igraču se računa oko 60% šanse da igra. Povrede se proveravaju stalno, pa se prognoza može promeniti do početka meča.</p>
      </Q>
      <Q q="Šta znače Neizvesno, Umereno, Sigurno i Veoma sigurno?">
        <ul className="chips">
          {([[0.5, 'ispod 60%'], [0.6, 'od 60%'], [0.7, 'od 70%'], [0.8, 'od 80%']] as const).map(([c, t]) => <li key={c}><Chip c={c} /> {t}</li>)}
        </ul>
        <p>Ni „veoma sigurno” ne znači da se ne gubi: {sure.map((b) => `od ${pct(b.min)} naviše pogođeno je ${pct(b.pct, 1)}`).join(', ')}.</p>
      </Q>
      <Q q="Kako model uči iz grešaka?">
        <p>Posle svakog meča menjaju se rejtinzi timova i igrača, a model se redovno ponovo trenira. Svaki promašaj dobija analizu na strani Greške. Dodatne korekcije po situacijama su trenutno {s.lessonGate.active ? 'uključene' : 'isključene'}, a po timovima {s.teamGate.active ? 'uključene' : 'isključene'}: rade samo dok dokazano smanjuju grešku.</p>
      </Q>
      <Q q="Kako se računa predlog uloga?">
        <p>Četvrtinom Kelly formule: što je kvota bolja u odnosu na našu šansu, ulog je veći, najviše 3% budžeta. Ako je kvota manja od poštene, predlog je 0 din. U simulaciji su ovi ulozi {s.staking.roi < 0 ? 'izgubili' : 'doneli'} {num(Math.abs(s.staking.roi) * 100)} din na svakih 100, pa ih prati na papiru.</p>
      </Q>
      <Q q="Koliko često model pogađa?">
        <p>Od 2018/19 pogodio je {pct(s.overall.pct, 1)} od {int(s.overall.total)} mečeva u simulaciji. Svi brojevi su na strani Učinak.</p>
      </Q>
      <Q q="Šta se ne koristi?"><p>Podaci sa kamera o kretanju igrača i odnos uplata na kladionicama, jer za njih nema besplatnog izvora.</p></Q>
      <Q q="Kada piše „Preporučujem da igraš”?">
        <p>Kad naša šansa za tim iznosi bar 40% i bar 5% je bolja od onoga što kvota traži (kvota 2,00 traži 50%). Može biti i autsajder, ako analiza vidi više nego kladionica. Preporuka se zaključava na početku meča i meri se na strani Učinak. Isto pravilo je u simulaciji bilo u minusu, pa se preporuke za sada prate papirno.</p>
      </Q>

      <h2 className="faq-sub">Terminologija</h2>
      <Q q="Elo">
        <p>Rejting snage tima, isti princip kao u šahu. Svaki tim ima broj (prosek je oko 1500). Posle meča pobednik uzima poene od poraženog: više ako je pobedio jačeg protivnika ili pobedio ubedljivo, manje ako je pobedio slabijeg. Iz razlike rejtinga dva tima, uz prednost domaćeg terena, dobija se šansa za pobedu.</p>
        <p>Primer: tim sa 1600 protiv tima sa 1500 na neutralnom terenu ima oko 64% šanse.</p>
      </Q>
      <Q q="Glicko">
        <p>Unapređen Elo. Pored rejtinga pamti i <strong>koliko je rejting pouzdan</strong>. Na početku sezone, ili posle velike promene u timu, pouzdanost je mala, pa rejting brže reaguje na nove rezultate. Kad tim odigra mnogo mečeva, rejting se smiri i menja se sporije.</p>
      </Q>
      <Q q="Logistička regresija">
        <p>Jednostavan statistički model koji svakom parametru (forma, umor, povrede, efikasnost...) daje težinu: koliko on pomera šansu i u kom smeru. Saberu se svi doprinosi, a zbir se pretvori u procenat između 0 i 100%. Prednost: lako se vidi zašto je model nešto odlučio. Mana: ne vidi kombinacije, na primer da je umor gori kad tim i putuje.</p>
      </Q>
      <Q q="Gradient boosting">
        <p>Model sastavljen od stotina malih „stabala odlučivanja”. Stablo postavlja niz pitanja tipa „da li je favorit igrao juče?” → „da li mu fali najbolji igrač?” i za svaki odgovor daje malu korekciju. Svako novo stablo uči na greškama prethodnih. Za razliku od logističke regresije, hvata kombinacije faktora, ali ga je teže objasniti.</p>
      </Q>
      <Q q="Razlika poena">
        <p>Peti model ne predviđa pobednika, nego za koliko poena će domaćin dobiti ili izgubiti (na primer +4,5). Iz te razlike i uobičajenog odstupanja NBA mečeva računa se šansa za pobedu. Koristi se i za projekciju rezultata na kartici.</p>
      </Q>
      <Q q="Spajanje modela (težine)">
        <p>Pet modela daje pet šansi. One se ne sabiraju podjednako: na ranijim mečevima se izmeri koji model je bio tačniji, i on dobija veću težinu. Težine se vide u primeru na vrhu ove strane.</p>
      </Q>
      <Q q="Četiri faktora">
        <p>Četiri stvari koje najviše odlučuju košarkaški meč (po analitičaru Dinu Oliveru):</p>
        <ol className="steps">
          <li><strong>Šut (eFG%)</strong>: procenat šuta gde trojka vredi 1,5 puta više od dvojke. Najvažniji faktor.</li>
          <li><strong>Izgubljene lopte (TOV%)</strong>: koliko napada se završi izgubljenom loptom, bez šuta.</li>
          <li><strong>Skok u napadu (ORB%)</strong>: koliko svojih promašaja tim vrati skokom i dobije novi napad.</li>
          <li><strong>Slobodna bacanja (FTr)</strong>: koliko često tim stiže na liniju u odnosu na broj šuteva.</li>
        </ol>
        <p>Model gleda svaki faktor u napadu i u odbrani (šta tim dozvoljava protivniku) i poredi dva tima.</p>
      </Q>
      <Q q="Efikasnost po posedu">
        <p>Koliko poena tim postigne, odnosno primi, na 100 napada. Ovako se porede timovi koji igraju brzo i sporo: brz tim daje više poena i zato što ima više napada, a ne samo zato što je bolji.</p>
      </Q>
      <Q q="Regresija ka sredini">
        <p>Neobično dobri ili loši rezultati se vremenom vraćaju ka proseku, jer je deo njih bio sreća. Primer: tim koji inače pogađa 36% trojki, a u poslednja tri meča pogađa 45%, verovatno neće nastaviti tako. Očekuje se da se vrati blizu 36%.</p>
        <p>Model to koristi na tri mesta:</p>
        <ul className="plain">
          <li><strong>Šut:</strong> kad je tim nedavno šutirao trojke mnogo iznad ili ispod svog proseka, to se ne uzima kao prava forma.</li>
          <li><strong>Između sezona:</strong> Elo i Glicko rejting se pomere 25% nazad ka proseku, jer se timovi preko leta menjaju.</li>
          <li><strong>Igrači:</strong> procena igrača sa malo odigranih minuta se drži bliže proseku, dok se ne skupi dovoljno podataka.</li>
        </ul>
      </Q>
      <Q q="Kvota, EV i „treba za nulu”">
        <p><strong>Decimalna kvota</strong> kaže koliko se vraća za 1 dinar: kvota 1,80 vraća 1,80 din. <strong>„Treba za nulu”</strong> je 1 ÷ kvota: na kvoti 1,80 moraš pogoditi bar 55,6% da ne bi bio u minusu. <strong>EV</strong> (očekivana vrednost) je naša šansa × kvota − 1: kod šanse 60% i kvote 1,80 to je +8%, što znači da se dugoročno očekuje 8 din dobitka na svakih 100 uloženih.</p>
      </Q>
      <Q q="CLV">
        <p>Razlika između kvote koju smo uzeli i završne kvote pred meč. Ako smo uzeli 2,10, a završna je 1,95, kvota se pomerila ka našem izboru i CLV je pozitivan. Dugoročno, pozitivan CLV je najbolji znak da analiza vidi nešto pre kladionice.</p>
      </Q>
      <Q q="Log loss i Brier">
        <p>Mere koliko su procenti tačni, a ne samo da li je pobednik pogođen. Ko kaže 90% i pogreši, kažnjava se mnogo više od onoga ko kaže 55% i pogreši. Manje je bolje.</p>
      </Q>
    </section>
  );
}
