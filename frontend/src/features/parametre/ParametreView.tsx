import { type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * "Hva komreg trenger" — a static explainer page for whoever is using the tool.
 *
 * The point is the division of labour, not the format. Komreg moves tilhørighet and lets
 * everything under the ID prefix inherit by itself, so a person fills in very few values —
 * the rest of the parameterfil is derived. That insight is what the page exists for; it is
 * nowhere else the app can show it.
 *
 * Deliberately **not** a rendering of the wire format. The contract already exists in
 * several hand-maintained copies; one more in prose here would be the one that quietly got
 * it wrong. The field-by-field reference is `regulering-format.md` in
 * `kartverket/smia-docs`, and ../../docs/parameterfil-grensejustering.md describes what
 * this tool produces — this page is about roles and about the inputs you actually own, and
 * stays true even when a field name changes.
 *
 * It opens on the three 2027 sakene because that is the job: translating a decision under
 * inndelingslova into komreg parameters. Nærøysund → Bindal is also the pair the reference
 * payload in ReguleringKontraktTest is built on, and the one that crosses a fylke boundary.
 *
 * The krets shape per sak is here because it is the only thing on the page that decides
 * anything: two of the sakene move *part of* a grunnkrets, and there is no choice there —
 * a krets transformasjon is 1:1 with no splitting form, so the teiger can only move as
 * ordinary rows. Stranda → Fjord moves a whole one, and that is the one case where the
 * question in `../docs/adr/0006-krets-som-transformasjon.md` is open. Keep the two apart
 * here; merging them into "krets is unresolved" would read as if all three sakene were
 * waiting on something.
 *
 * A top-level route, outside the pathless map layout: the page reads no session, and
 * hanging it under the layout would mount OpenLayers to read prose.
 *
 * Links only to routes that make sense without an open list (/, /reguleringer, /kjoring).
 * The arbeidsliste and the komreg-liste are named in prose instead — they sit under the map
 * layout and show an empty shell without a loaded list, and this page is normally read cold.
 */
export function ParametreView() {
  return (
    <div className="overlay-page">
      <div className="overlay-header">
        <Link
          to="/"
          className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'no-underline')}
        >
          ← Grensejusteringer
        </Link>
        <div className="font-semibold">Hva komreg trenger</div>
      </div>

      {/* Reading width, centred: this is the only page in the app that is prose, and a
          line of text across a wide screen becomes unreadable. The other overlay pages
          are tables and should use the width. */}
      <div className="flex-1 overflow-auto p-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-8">
          <p className="text-sm text-muted-foreground">
            Komreg gjør mesteparten av jobben selv. Det dette verktøyet lager er{' '}
            <em>parameterfila</em> — de få verdiene komreg ikke kan utlede. Denne siden sier hva de
            er, hva som følger av dem, og hva som med vilje ikke er en parameter i det hele tatt.
          </p>

          <Seksjon tittel="1 · Jobben: fra vedtak til parametre">
            <Punkter>
              <li>
                En <Sterk>grensejustering</Sterk> er flytting av et område fra én kommune til en
                annen — eller av en kommune fra ett fylke til et annet. Den er hjemlet i
                inndelingslova og avgjøres av Kommunal- og distriktsdepartementet, eller av
                statsforvalteren i mindre saker der kommunene er enige, etter fullmakt fra Kongen.
              </li>
              <li>
                Vedtatte grensejusteringer trer i kraft <Sterk>1. januar</Sterk>. Det er derfor
                ikrafttredelsesdatoen du fyller inn alltid er en 1. januar, og hvorfor sakene samles
                i én leveranse per årsskifte.
              </li>
              <li>
                <Sterk>Oppgaven her er oversettelsen.</Sterk> Vedtaket beskriver et område på et
                kart. Komreg trenger identifikatorer. Alt dette verktøyet gjør er å gå fra det
                første til det andre.
              </li>
              <li>
                Fra <Sterk>1.1.2027</Sterk> gjelder tre saker. To av dem flytter <em>en del av</em>{' '}
                en grunnkrets — grensa går tvers gjennom den — og én flytter en hel:
              </li>
            </Punkter>
            <Tabell
              kolonner={['Saken', 'Kommunepar', 'Grunnkrets']}
              rader={[
                [
                  <>Ullensaker → Eidsvoll</>,
                  <>
                    <Kode>3209</Kode> → <Kode>3240</Kode>, innad i Akershus
                  </>,
                  <>del av en krets</>,
                ],
                [
                  <>Nærøysund → Bindal</>,
                  <>
                    <Kode>5060</Kode> → <Kode>1811</Kode>, over fylkesgrensa
                  </>,
                  <>del av en krets</>,
                ],
                [
                  <>Stranda → Fjord</>,
                  <>
                    <Kode>1525</Kode> → <Kode>1578</Kode>, innad i Møre og Romsdal
                  </>,
                  <>
                    <Sterk>en hel krets</Sterk>
                  </>,
                ],
              ]}
            />
            <Punkter>
              <li>
                <Sterk>Forskjellen på de to formene betyr noe.</Sterk> Flytter du en del av en
                krets, finnes det ingenting annet å gjøre enn å flytte teigene: formatet har ingen
                måte å dele en krets på. Flytter du en hel, er det et åpent spørsmål om kretsen også
                skal renummereres inn i mottakerkommunen — se avsnitt 5.
              </li>
              <li>
                Nærøysund → Bindal krysser <Sterk>fylkesgrensa</Sterk>, fra Trøndelag til Nordland.
                Mekanisk endrer ikke det noe: det eneste som skjer er at fylkesnummeret også blir
                ulikt på hver transformasjon.
              </li>
              <li>
                Tre kommunepar blir tre grensejusteringer her, og fire filer — én samlet, og én per
                par, så de kan kjøres hver for seg.
              </li>
            </Punkter>
            <p className="text-sm text-muted-foreground">
              <a
                href="https://www.regjeringen.no/no/tema/kommuner-og-regioner/kommunestruktur/Verktoy/justeringer-av-kommunegrenser/id2571217/"
                target="_blank"
                rel="noreferrer"
                className="text-primary"
              >
                regjeringen.no: justeringer av kommunegrenser
              </a>{' '}
              — sakene, prosessen og hvem som kan ta initiativ.
            </p>
          </Seksjon>

          <Seksjon tittel="2 · Hva komreg gjør selv">
            <Punkter>
              <li>
                <Sterk>Komreg flytter ikke grensa.</Sterk> Selve geometrien endres i Matrikkelen,
                som en egen prosess utenfor komreg. Er ikke den gjort, er det ingenting her som
                merker det.
              </li>
              <li>
                <Sterk>Komreg flytter tilhørighet.</Sterk> Jobben er å skrive om ID-prefikset —
                fylkesnummer og kommunenummer — på entitetene som havnet på den andre siden av den
                nye grensa.
              </li>
              <li>
                <Sterk>Og det kaskaderer.</Sterk> Alt under prefikset arver det nye automatisk:
                matrikkelenheter, teiger, veger, vegadresser, kretser, bygninger. Derfor er lista i
                neste avsnitt så kort — du peker ut hva som flytter, ikke alt som følger med.
              </li>
              <li>
                Komreg-backend kjører <em>inne i</em> Matrikkelen, og en kjøring er fire-and-forget:
                den svarer så snart den er i gang. Ingenting her kan forhåndsvise, verifisere eller
                angre det som skjedde. Det er derfor «Start kjøring» spør først.
              </li>
            </Punkter>
          </Seksjon>

          <Seksjon tittel="3 · Hva du fyller ut">
            <p className="text-sm text-muted-foreground">
              Dette er hele inndataflaten. Alt annet i parameterfila følger av disse.
            </p>
            <Tabell
              kolonner={['Verdi', 'Hvor du setter den']}
              rader={[
                [
                  <>
                    <Kode>navn</Kode>, ikrafttredelsesdato
                  </>,
                  <>
                    På{' '}
                    <Link to="/reguleringer" className="text-primary">
                      reguleringen
                    </Link>{' '}
                    — de gjelder leveransen som helhet, ikke den enkelte grensejusteringen.
                  </>,
                ],
                [
                  <>Utvalget: hvilke teiger som flytter</>,
                  <>
                    På kartet — enkeltklikk, en hel gårdsnummerserie, eller en grunnkrets om gangen.
                  </>,
                ],
                [
                  <>Flytt til kommune</>,
                  <>
                    På komreg-lista. Gjelder alle rader, og er som regel den eneste verdien du
                    setter.
                  </>,
                ],
                [
                  <>Overstyringer per rad: nytt gnr, bnr, adressekode, adressenummer</>,
                  <>
                    På komreg-lista, når en verdi ikke kan beholdes — typisk et gårdsnummer som
                    kolliderer med en serie som allerede finnes i mottakerkommunen.
                  </>,
                ],
              ]}
            />
          </Seksjon>

          <Seksjon tittel="4 · Hva som utledes">
            <Punkter>
              <li>
                <Sterk>Fylkesnummer og kommuneløpenummer skrives aldri inn.</Sterk> Kommunenummeret
                splittes to og to: <Kode>3209</Kode> blir fylke <Kode>32</Kode> og løpenummer{' '}
                <Kode>09</Kode>.
              </li>
              <li>
                <Sterk>Komreg base-id-en myntes av navnet.</Sterk> Den er bare prefikset på id-en
                hver testkjøring får hos komreg-backend, så du taster den ikke inn — en kort
                tilfeldig hale holder den unik.
              </li>
              <li>
                <Sterk>En teig beholder id-en sin.</Sterk> Teig-id går inn som «fra» og ut som samme
                «til» — det er bare kommunetilhørigheten som flytter.
              </li>
              <li>
                <Sterk>Grupperingen gjør backend.</Sterk> Radene samles i én endring per kommunepar.
                Tre kommunepar gir fire filer: én samlet, og én per par.
              </li>
              <li>
                <Sterk>Blankt felt er en instruksjon, ikke en manglende verdi.</Sterk> Blankt
                bruksnummer betyr «hele gården», blankt adressenummer betyr «hele vegen».
              </li>
              <li>
                Fila inneholder fire transformasjonstyper — <Kode>matrikkelenhet</Kode>,{' '}
                <Kode>teig</Kode>, <Kode>veg</Kode>, <Kode>vegadresse</Kode>. Det er det en
                grensejustering trenger, og det er alt verktøyet sender.
              </li>
            </Punkter>
          </Seksjon>

          <Seksjon tittel="5 · Hva som ikke er en parameter">
            <Punkter>
              <li>
                <Sterk>Kommentarer.</Sterk> De redigeres på arbeidslista, men forlater aldri appen —
                formatet har ikke noe felt for dem. De er notater til deg selv.
              </li>
              <li>
                <Sterk>Festenummer og seksjonsnummer.</Sterk> Fanges opp fra kartet og vises, men
                ingen transformasjon bærer dem.
              </li>
              <li>
                <Sterk>Sammenslåing og deling.</Sterk> Feltene for nye og utgående fylker og
                kommuner står alltid tomme her. En sammenslåing eller en deling trenger dem — og
                trenger andre transformasjonstyper — og er utenfor det dette verktøyet gjør.
              </li>
              <li>
                <Sterk>Krets — et åpent spørsmål, og bare for én av de tre sakene.</Sterk> Komreg
                støtter en krets-transformasjon og har hatt en testet sti for den i årevis.
                Verktøyet sender den ikke. Når en hel grunnkrets flytter i dag, blir kretsen
                hengende på begge kommuner i stedet for å bli renummerert inn i mottakeren — det var
                utfallet i Risør→Tvedestrand i 2025. Om det er den riktige sluttilstanden er en
                avgjørelse hos registereier, ikke i dette verktøyet. Det gjelder{' '}
                <Sterk>Stranda → Fjord</Sterk>; de to andre flytter del av en krets, og der finnes
                ikke valget — en krets-transformasjon er 1:1 og kan ikke dele.
              </li>
              <li>
                Skulle svaret bli at kretsen <em>skal</em> renummereres, er nummeret å sende ikke
                det du ser på kartet: kartlaget oppgir et åttesifret grunnkretsnummer som er
                kommunenummer pluss kretsnummer (<Kode>42010305</Kode> = kommune <Kode>4201</Kode>,
                krets <Kode>305</Kode>), og det er de fire siste komreg vil ha. Det finnes heller
                ingen åpen kilde til hvilke kretsnummer som er i bruk i mottakerkommunen, så et
                ledig nummer kan ikke foreslås eller kollisjonssjekkes — det må komme fra noen som
                vet.
              </li>
            </Punkter>
            <p className="text-sm text-muted-foreground">
              «Flytt grunnkrets» på kartet er for øvrig en <em>utvalgsmåte</em>, ikke en parameter:
              den plukker hver teig som har representasjonspunktet sitt i kretsen, og de flytter
              deretter som helt vanlige rader.
            </p>
          </Seksjon>

          <Seksjon tittel="6 · Hvem sjekker hva">
            <Punkter>
              <li>
                <Sterk>Komreg validerer ikke en ren grensejustering.</Sterk> Reglene der treffer
                fylkesdeling, kommunedeling og vegdeling. En grensejustering matcher ingen av dem og
                passerer ved å ikke være dekket.
              </li>
              <li>
                <Sterk>
                  Så «Sjekk verdier» og valideringen ved generering er de eneste kontrollene som
                  kjører
                </Sterk>{' '}
                på disse parametrene i det hele tatt. Det er verdt å bruke dem.
              </li>
              <li>
                Matrikkel-halvdelen av sjekken er <em>best effort</em> med vilje: ingen åpen API
                bekrefter at en matrikkelenhet finnes, så de funnene er advarsler, aldri feil.
                Adressehalvdelen er autoritativ — Geonorges adresseregister <em>er</em> registeret.
              </li>
              <li>
                Valideringen hos komreg kjører ved <Sterk>kjøringsstart</Sterk>, ikke ved
                innsending. En payload kan landes helt fint og likevel feile når den startes — se{' '}
                <Link to="/kjoring" className="text-primary">
                  Kjøring
                </Link>
                .
              </li>
            </Punkter>
          </Seksjon>
        </div>
      </div>
    </div>
  )
}

function Seksjon({ tittel, children }: { tittel: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">{tittel}</h2>
      {children}
    </section>
  )
}

function Punkter({ children }: { children: ReactNode }) {
  return <ul className="flex list-disc flex-col gap-2 pl-5 text-sm leading-relaxed">{children}</ul>
}

function Sterk({ children }: { children: ReactNode }) {
  return <span className="font-medium text-foreground">{children}</span>
}

function Kode({ children }: { children: ReactNode }) {
  return <code className="rounded bg-card px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
}

/** The first column carries the key and is in full colour; the rest is supporting and dimmed. */
function Tabell({ kolonner, rader }: { kolonner: string[]; rader: ReactNode[][] }) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-border text-left text-muted-foreground">
          {kolonner.map((k) => (
            <th key={k} className="py-1.5 pr-4 font-medium">
              {k}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rader.map((rad, i) => (
          <tr key={i} className="border-b border-border align-top">
            {rad.map((celle, j) => (
              <td
                key={j}
                className={cn('py-2 pr-4 leading-relaxed', j > 0 && 'text-muted-foreground')}
              >
                {celle}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
