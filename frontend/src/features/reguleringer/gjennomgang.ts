// Reads a finished parameterfil back into something a fagperson can check by eye: per
// kommunepar, what moves and to which numbers. Pure — no fetch, no React.
//
// It reads the *payload*, not the komreg rows the payload was built from. The point of the
// review is "is what we send right", and the only thing that is byte for byte what gets sent
// is the backend's serialized string (ADR-0003). Reading the rows instead would review our
// own input to the builder and trust the builder — the one step a review should not trust.
//
// Reading is not building: nothing here produces or re-serializes a payload, so this is not a
// second copy of the wire format in the ADR-0002 sense. The schema below is deliberately
// loose (no .strict(), optional where the builder may omit) — a field it doesn't know is
// ignored, and only a shape it cannot read at all is an error.
import { z } from 'zod'

const fraTil = z.object({ fra: z.string(), til: z.string() })
const fraTilMange = z.object({ fra: z.string(), til: z.array(z.string()) })

// The nested target of a single bruksnummer. Every field but bruksnummer may be left out,
// and a missing one inherits the outer `.til` — see byggMatrikkelenhet in the backend.
const tilGrunneiendom = z.object({
  fylkesnummer: z.number().nullish(),
  kommunelopenummer: z.number().nullish(),
  gardsnummer: z.number().nullish(),
  bruksnummer: z.number(),
})

const transformasjon = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('matrikkelenhet'),
    fylkesnummer: fraTil,
    kommuneløpenummer: fraTil,
    gårdsnummer: fraTil,
    bruksnummer: z.record(z.string(), tilGrunneiendom).nullish(),
  }),
  z.object({
    type: z.literal('teig'),
    fylkesnummer: fraTil,
    kommuneløpenummer: fraTil,
    teigId: fraTil,
  }),
  z.object({
    type: z.literal('veg'),
    fylkesnummer: fraTilMange,
    kommuneløpenummer: fraTilMange,
    adressekode: fraTilMange,
  }),
  z.object({
    type: z.literal('vegadresse'),
    fylkesnummer: fraTil,
    kommuneløpenummer: fraTil,
    adressekode: fraTil,
    adressenummer: fraTil,
  }),
  // fylke / kommune / krets: declared by the wire format, never built here (backend
  // AGENTS.md). Counted under their own name so they can't vanish from the review.
  z.object({ type: z.enum(['fylke', 'kommune', 'krets']) }),
])

const parameterfilSchema = z.object({
  id: z.string(),
  navn: z.string(),
  dato: z.string(),
  endringer: z.array(
    z.object({
      id: z.string(),
      navn: z.string(),
      transformasjoner: z.array(transformasjon),
    }),
  ),
})

/** One thing that moves. `tilKommune` is set only when it differs from the pair's. */
export interface Flytting {
  fra: string
  til: string
  // The number itself changes, not just the kommune it belongs to. That is the part a
  // reviewer has to check against the vedtak; a pure kommune move is the default.
  nyttNummer: boolean
  tilKommune?: string
  // Veg/vegadresse only: the street code in the *source* kommune, so a name can be looked
  // up for it. The payload carries numbers only.
  adressekode?: string
}

export interface ParGjennomgang {
  id: string
  fraKommune: string
  tilKommune: string
  fylkesbytte: boolean
  heleGarder: Flytting[]
  bruksnumre: Flytting[]
  teiger: string[]
  veger: Flytting[]
  vegadresser: Flytting[]
  andre: string[]
  antall: number
}

export interface Gjennomgang {
  id: string
  navn: string
  dato: string
  par: ParGjennomgang[]
  antall: number
}

export class UlesbarParameterfil extends Error {
  constructor(detalj: string) {
    super(`Kunne ikke lese parameterfila: ${detalj}`)
    this.name = 'UlesbarParameterfil'
  }
}

const pad2 = (n: number | string) => String(n).padStart(2, '0')
const kommune = (fylke: string, lopenummer: string) => `${fylke}${lopenummer}`
// Natural order for "90/4" < "90/10" < "290/1": compare segment by segment, numerically.
const naturlig = (a: string, b: string) => a.localeCompare(b, 'nb', { numeric: true })
const sortert = (xs: Flytting[]) => xs.sort((a, b) => naturlig(a.fra, b.fra))

export function lesParameterfil(json: string): Gjennomgang {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new UlesbarParameterfil('ikke gyldig JSON')
  }
  const parsed = parameterfilSchema.safeParse(raw)
  if (!parsed.success)
    throw new UlesbarParameterfil(parsed.error.issues[0]?.message ?? 'ukjent form')
  const fil = parsed.data

  const par = fil.endringer.map((e): ParGjennomgang => {
    // The pair comes from the endring id ("5060-1811"), which the backend builds from the
    // pair, rather than from the first transformasjon — an endring may have none of a kind.
    const [fraKommune = '', tilKommune = ''] = e.id.split('-')
    const p: ParGjennomgang = {
      id: e.id,
      fraKommune,
      tilKommune,
      fylkesbytte: fraKommune.slice(0, 2) !== tilKommune.slice(0, 2),
      heleGarder: [],
      bruksnumre: [],
      teiger: [],
      veger: [],
      vegadresser: [],
      andre: [],
      antall: e.transformasjoner.length,
    }
    const annenKommune = (k: string) => (k !== tilKommune ? k : undefined)
    for (const t of e.transformasjoner) {
      switch (t.type) {
        case 'matrikkelenhet': {
          const gnr = t.gårdsnummer
          if (!t.bruksnummer) {
            p.heleGarder.push({
              fra: gnr.fra,
              til: gnr.til,
              nyttNummer: gnr.fra !== gnr.til,
              tilKommune: annenKommune(kommune(t.fylkesnummer.til, t.kommuneløpenummer.til)),
            })
            break
          }
          for (const [bnr, mal] of Object.entries(t.bruksnummer)) {
            const tilGnr = mal.gardsnummer != null ? String(mal.gardsnummer) : gnr.til
            const fylke = mal.fylkesnummer != null ? pad2(mal.fylkesnummer) : t.fylkesnummer.til
            const lop =
              mal.kommunelopenummer != null ? pad2(mal.kommunelopenummer) : t.kommuneløpenummer.til
            const fra = `${gnr.fra}/${bnr}`,
              til = `${tilGnr}/${mal.bruksnummer}`
            p.bruksnumre.push({
              fra,
              til,
              nyttNummer: fra !== til,
              tilKommune: annenKommune(kommune(fylke, lop)),
            })
          }
          break
        }
        case 'teig':
          p.teiger.push(t.teigId.fra)
          break
        case 'veg': {
          const til = t.adressekode.til.join(', ')
          p.veger.push({
            fra: t.adressekode.fra,
            til,
            nyttNummer: til !== t.adressekode.fra,
            adressekode: t.adressekode.fra,
          })
          break
        }
        case 'vegadresse': {
          const fra = `${t.adressekode.fra} nr ${t.adressenummer.fra}`,
            til = `${t.adressekode.til} nr ${t.adressenummer.til}`
          p.vegadresser.push({ fra, til, nyttNummer: fra !== til, adressekode: t.adressekode.fra })
          break
        }
        default:
          p.andre.push(t.type)
      }
    }
    sortert(p.heleGarder)
    sortert(p.bruksnumre)
    sortert(p.veger)
    sortert(p.vegadresser)
    p.teiger.sort(naturlig)
    return p
  })

  return {
    id: fil.id,
    navn: fil.navn,
    dato: fil.dato,
    par,
    antall: par.reduce((n, p) => n + p.antall, 0),
  }
}

/** Distinct (source kommune, adressekode) pairs in the file, for the street-name lookup. */
export function adressekoder(g: Gjennomgang): { kommune: string; adressekode: string }[] {
  const ut = new Map<string, { kommune: string; adressekode: string }>()
  for (const p of g.par) {
    for (const r of [...p.veger, ...p.vegadresser]) {
      if (r.adressekode) {
        ut.set(`${p.fraKommune}-${r.adressekode}`, {
          kommune: p.fraKommune,
          adressekode: r.adressekode,
        })
      }
    }
  }
  return [...ut.values()]
}
