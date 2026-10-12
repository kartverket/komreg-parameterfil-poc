import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { listsQuery } from '@/data/listQueries'
import type { Miljo } from '@/data/kjoring'
import { miljoQuery } from '@/data/useKjoring'
import { MiljoBadge } from '@/components/MiljoBadge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { useConfirm } from '@/hooks/useConfirm'
import { cn } from '@/lib/utils'
import { MedlemmerTable } from './MedlemmerTable'
import { PreviewFiles } from './PreviewFiles'
import { REGULERINGER_KEY, reguleringQuery, testRunsQuery } from './queries'
import { generateRegulering, type GenererResponse } from './regulering'
import {
  RUN_STATUS_TEXT,
  startSentRun,
  startTestRun,
  updateRegulering,
  type TestRun,
} from './reguleringer'
import { ReguleringFields } from './ReguleringFields'
import { RunHistory } from './RunHistory'
import { matrikkelAdvarsel, resolveAndCheckLists, type ResolvedLists } from './useRegulering'

// One saved regulering: its header, which grensejusteringer are in it, and its test runs.
// The page holds the drafts and everything that leads up to a run, the confirm included;
// the sections it renders only display and report clicks.
export function ReguleringView({ id }: { id: number }) {
  const qc = useQueryClient()
  const detail = useQuery(reguleringQuery(id))
  const lists = useQuery(listsQuery)
  const runs = useQuery(testRunsQuery(id))
  const [navn, setNavn] = useState(''),
    [baseId, setBaseId] = useState(''),
    [dato, setDato] = useState('')
  const [members, setMembers] = useState<Set<number>>(new Set()),
    [runSelection, setRunSelection] = useState<Set<number>>(new Set())
  const [preview, setPreview] = useState<GenererResponse | null>(null),
    [message, setMessage] = useState(''),
    [sjekkerVerdier, setSjekkerVerdier] = useState(false),
    [sjekkerMatrikkel, setSjekkerMatrikkel] = useState(false)

  // The test selection is the user's choice, not the regulering's. Saving bumps updated_at,
  // which gives a new detail.data and runs this effect again — so a plain seeding here
  // would reset a deliberately narrowed selection to "all" right before an irreversible
  // kjøring, without saying so. The first load selects everything; after that the selection
  // stands, and only the membership trims it. New members are already in the selection: the
  // checkbox below puts them in both.
  //
  // The drafts are seeded in an effect on purpose. The alternative, remounting the form on a
  // new detail.data, would need this selection and the preview lifted out of it first.
  const seeded = useRef(false)
  useEffect(() => {
    const d = detail.data
    if (!d) return
    // oxlint-disable-next-line react/set-state-in-effect
    setNavn(d.navn)
    setBaseId(d.baseId)
    setDato(d.dato)
    setMembers(new Set(d.listIds))
    // Read the ref here, not inside the updater: React runs the updater later, during the
    // next render, by which time the ref already says "seeded" — and the first load would
    // trim an empty selection instead of selecting everything.
    const first = !seeded.current
    seeded.current = true
    setRunSelection((old) =>
      first ? new Set(d.listIds) : new Set(d.listIds.filter((x) => old.has(x))),
    )
  }, [detail.data])
  const dirty =
    !!detail.data &&
    (navn !== detail.data.navn ||
      dato !== detail.data.dato ||
      members.size !== detail.data.listIds.length ||
      detail.data.listIds.some((x) => !members.has(x)))
  const save = useMutation({
    mutationFn: () =>
      updateRegulering(id, {
        baseId,
        navn,
        dato,
        listIds: [...members],
        updatedAt: detail.data!.updatedAt,
      }),
    onSuccess: async () => {
      setMessage('Lagret')
      await qc.invalidateQueries({ queryKey: reguleringQuery(id).queryKey })
      await qc.invalidateQueries({ queryKey: REGULERINGER_KEY })
    },
    onError: (e) => setMessage(e.message),
  })
  // Who the next run is made from: the lists ticked in the testutvalg, in the index's order.
  const chosen = (lists.data ?? []).filter((l) => runSelection.has(l.id))
  const previewMutation = useMutation({
    mutationFn: async () => {
      const d = await resolveAndCheckLists(chosen, qc)
      return generateRegulering({ id: baseId, navn, dato, rader: d.rows })
    },
    onSuccess: (v) => {
      setPreview(v)
      setMessage('Forhåndsvisning generert')
    },
    onError: (e) => setMessage(e.message),
  })
  // Naming the target is the last thing read before an irreversible action, so it must not
  // be the one place that guesses: it is fetched for each confirm, never taken from the
  // cache, and the run carries its url so the backend can refuse if it points elsewhere.
  const hentMiljo = async (): Promise<Miljo | null> => {
    try {
      return await qc.fetchQuery({ ...miljoQuery, staleTime: 0 })
    } catch (e) {
      setMessage((e as Error).message)
      return null
    }
  }
  const { confirm, dialog } = useConfirm()
  const afterRun = {
    onSuccess: async (v: TestRun) => {
      setMessage(RUN_STATUS_TEXT[v.status] ?? v.status)
      await qc.invalidateQueries({ queryKey: testRunsQuery(id).queryKey })
      await qc.invalidateQueries({ queryKey: REGULERINGER_KEY })
    },
    onError: (e: Error) => {
      setMessage(e.message)
      // A refusal may be the target having moved; let the badge catch up.
      void qc.invalidateQueries({ queryKey: miljoQuery.queryKey })
    },
  }
  const run = useMutation({
    mutationFn: async (v: { start: boolean; d: ResolvedLists; miljo: Miljo }) => {
      const { start, d } = v
      return startTestRun(id, {
        expectedKomregUrl: v.miljo.url,
        expectedReguleringUpdatedAt: detail.data!.updatedAt,
        sources: d.sources,
        rader: d.rows,
        start,
      })
    },
    ...afterRun,
  })
  const startSent = useMutation({
    mutationFn: (v: { runId: number; miljo: Miljo }) => startSentRun(id, v.runId, v.miljo.url),
    ...afterRun,
  })
  if (detail.isPending || lists.isPending) return <div className="p-4">Henter regulering…</div>
  if (!detail.data || detail.isError || lists.isError)
    return <div className="p-4 text-destructive">Kunne ikke hente reguleringen.</div>
  const archived = detail.data.archivedAt != null
  const toggle = (setter: Dispatch<SetStateAction<Set<number>>>, value: number) =>
    setter((old) => {
      const next = new Set(old)
      if (!next.delete(value)) next.add(value)
      return next
    })
  // A list joins or leaves the regulering. The testutvalg follows: a new member is ticked
  // for the next run, and one that left cannot stay in it.
  const toggleMember = (listId: number) => {
    const was = members.has(listId)
    toggle(setMembers, listId)
    setRunSelection((old) => {
      const n = new Set(old)
      if (was) n.delete(listId)
      else n.add(listId)
      return n
    })
    setPreview(null)
  }
  // TOGGLE_SINK_OFF is set on the deployed pod, not by us, so a run against dev can
  // write to Matrikkelen. Say which komreg-backend this is going to, by host.
  const mot = (miljo: Miljo) => `Mot ${miljo.navn.toUpperCase()} (${miljo.url}).`
  // Send-only and send-and-start share one confirm: both put a regulering into
  // komreg-backend, and both read the same warnings. Only the last paragraph differs —
  // whether this is the irreversible step or not.
  const confirmRun = async (start: boolean) => {
    const miljo = await hentMiljo()
    if (!miljo) return
    let d: ResolvedLists
    setSjekkerVerdier(true)
    try {
      d = await resolveAndCheckLists(chosen, qc)
    } catch (e) {
      setMessage((e as Error).message)
      return
    } finally {
      setSjekkerVerdier(false)
    }
    setSjekkerMatrikkel(true)
    const matrikkel = await matrikkelAdvarsel(chosen).finally(() => setSjekkerMatrikkel(false))
    const ok = await confirm({
      title: start ? `Sende og starte «${navn}»?` : `Sende «${navn}» til komreg-backend?`,
      body: [
        `Med: ${chosen.map((x) => x.name).join(', ')}.`,
        mot(miljo),
        forbehold(),
        matrikkel,
        start
          ? 'Kjøringen kan ikke stoppes herfra.'
          : 'Reguleringen legges i komreg-backends database, men startes ikke. Start den fra testhistorikken når den er sjekket. Merk at komreg-backend validerer først ved start.',
      ]
        .filter(Boolean)
        .join('\n\n'),
      confirmLabel: start ? 'Send og kjør' : 'Send',
    })
    if (ok) run.mutate({ start, d, miljo })
  }
  const confirmStartSent = async (r: TestRun) => {
    const miljo = await hentMiljo()
    if (!miljo) return
    const ok = await confirm({
      title: `Starte ${r.externalId}?`,
      body: [
        `Starter reguleringen som ble sendt ${r.createdAt.slice(0, 16)}, med: ${r.sources.map((x) => x.name).join(', ')}.`,
        mot(miljo),
        'Kjøringen kan ikke stoppes herfra.',
      ]
        .filter(Boolean)
        .join('\n\n'),
      confirmLabel: 'Start kjøring',
    })
    if (ok) startSent.mutate({ runId: r.id, miljo })
  }
  /**
   * What CAN keep the kjøring from going through — as text, not as a block.
   *
   * The button used to be disabled on these, and a grey button with no clickable way
   * forward is worse than a refusal that says why: the server decides anyway, it decides
   * on what is SAVED, and it has the whole explanation. So we warn and let the click
   * through. The header fields are worth a warning precisely because they give NO refusal:
   * the kjøring uses the saved values and says nothing about the form having said
   * something else.
   */
  function forbehold(): string {
    const grunner: string[] = []
    if (archived) grunner.push('Reguleringen er arkivert.')
    if (dirty) grunner.push('Ulagrede endringer — kjøringen bruker sist lagrede versjon.')
    grunner.push(...ubruktMedlemskap())
    return grunner.length ? `Merk: ${grunner.join(' ')}` : ''
  }
  function ubruktMedlemskap(): string[] {
    const lagrede = new Set(detail.data!.listIds)
    const nye = [...runSelection].filter((x) => !lagrede.has(x))
    return nye.length
      ? ['Grensejusteringer som ikke er lagret som medlemmer ennå blir avvist av serveren.']
      : []
  }

  return (
    <div className="overlay-page">
      <div className="overlay-header">
        <Link
          to="/reguleringer"
          className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'no-underline')}
        >
          ← Reguleringer
        </Link>
        <div className="font-semibold">{navn || 'Regulering'}</div>
        <MiljoBadge />
        <div className="flex-1" />
        {message && <span className="text-xs text-muted-foreground">{message}</span>}
        <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending || archived}>
          {save.isPending ? 'Lagrer…' : 'Lagre'}
        </Button>
      </div>
      <div className="flex-1 overflow-auto p-4">
        <div className="flex max-w-6xl flex-col gap-6">
          <ReguleringFields
            navn={navn}
            baseId={baseId}
            dato={dato}
            disabled={archived}
            onNavn={(v) => {
              setNavn(v)
              setPreview(null)
            }}
            onDato={(v) => {
              setDato(v)
              setPreview(null)
            }}
          />
          <MedlemmerTable
            lists={lists.data!}
            members={members}
            disabled={archived}
            onToggle={toggleMember}
          />
          <section className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">
                Testutvalg ({runSelection.size} av {members.size})
              </h2>
              <div className="flex-1" />
              {/*
                Forhåndsvisning er IKKE sperret av `dirty`, og det er ikke en forglemmelse:
                den treffer bare vår egen POST /regulering, aldri komreg-backend. Radene
                kommer uansett fra de lagrede listene — det er bare overskriftsfeltene som
                er skjemaets — så dette er nettopp filen du vil se på FØR du bestemmer deg
                for å lagre. Kjøringen er den som må ha en lagret regulering å vise til.
              */}
              <Button
                variant="secondary"
                onClick={() => previewMutation.mutate()}
                disabled={!runSelection.size || previewMutation.isPending}
              >
                {previewMutation.isPending ? 'Genererer…' : 'Forhåndsvis'}
              </Button>
              <Button
                variant="secondary"
                onClick={() => confirmRun(false)}
                disabled={!runSelection.size || run.isPending || sjekkerVerdier || sjekkerMatrikkel}
              >
                {sjekkerVerdier
                  ? 'Sjekker verdier…'
                  : run.isPending && !run.variables
                    ? 'Sender…'
                    : 'Send'}
              </Button>
              <Button
                onClick={() => confirmRun(true)}
                disabled={!runSelection.size || run.isPending || sjekkerVerdier || sjekkerMatrikkel}
              >
                {sjekkerVerdier
                  ? 'Sjekker verdier…'
                  : sjekkerMatrikkel
                    ? 'Sjekker matrikkelen…'
                    : run.isPending && run.variables
                      ? 'Kjører…'
                      : 'Send og kjør'}
              </Button>
            </div>
            {/*
              Den eneste sperren igjen er «ingenting er valgt», og den har en klikkbar vei
              videre rett under. Alt annet — arkivert, ulagret, ikke-medlem — er en advarsel
              i bekreftelsesdialogen i stedet: serveren avgjør, og et avslag med begrunnelse
              slår en grå knapp uten tooltip (knappevarianten har `disabled:pointer-events-none`,
              så et `title` på en deaktivert knapp vises aldri).
            */}
            <p className="text-xs text-muted-foreground">
              Kjøringen bruker sist lagrede versjon av hver grensejustering. Velg én, flere eller
              alle. «Send» legger reguleringen i komreg-backend uten å starte den.
              {!runSelection.size &&
                (members.size
                  ? ' Ingen er valgt — kryss av for minst én.'
                  : ' Reguleringen har ingen grensejusteringer ennå — kryss av for minst én over.')}
            </p>
            <div className="flex flex-wrap gap-4">
              {lists
                .data!.filter((l) => members.has(l.id))
                .map((l) => (
                  <label key={l.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={runSelection.has(l.id)}
                      onCheckedChange={() => {
                        toggle(setRunSelection, l.id)
                        setPreview(null)
                      }}
                    />
                    {l.name}
                  </label>
                ))}
            </div>
            {preview && <PreviewFiles preview={preview} />}
          </section>
          <RunHistory
            id={id}
            runs={runs.data ?? []}
            lists={lists.data ?? []}
            onStart={confirmStartSent}
            starting={startSent.isPending}
          />
        </div>
      </div>
      {dialog}
    </div>
  )
}
