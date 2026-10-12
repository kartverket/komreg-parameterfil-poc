import { describe, it, expect, afterEach, beforeEach } from 'vite-plus/test'
import { useStore } from './store'
import { buildKomregRows } from '@/domain/komreg'
import type { WorkingState } from '@/domain/domain'
import { teig } from '@/testing/fixtures'

// The store is a module-level singleton, so reset it to its initial shape before
// each test. The fetch layer behind the on-demand lookups is covered in external.test.ts;
// here it is stubbed, and what is tested is what the store does around it.
const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})
beforeEach(() => {
  useStore.setState({
    selected: [],
    wholeGnr: [],
    wholeAdressekode: [],
    comments: {},
    batchKommune: '',
    newValues: {},
    coverage: {},
    gnrCoverage: {},
    komregCheck: { status: 'idle', issues: [], snapshot: '' },
    currentListId: null,
    currentListName: null,
    currentListUpdatedAt: null,
  })
})

const ids = () => useStore.getState().selected.map((t) => t.id)

describe('toggle', () => {
  it('adds a teig, then removes it on a second toggle', () => {
    const t = teig(1, '0301', 208, 1)
    useStore.getState().toggle(t)
    expect(ids()).toEqual([1])
    useStore.getState().toggle(t)
    expect(ids()).toEqual([])
  })
})

describe('toggleGroup', () => {
  it('adds the whole group when none are selected', () => {
    useStore.getState().toggleGroup([teig(1, '0301', 208, 1), teig(2, '0301', 208, 2)])
    expect(ids()).toEqual([1, 2])
  })

  it('removes the whole group when all are already selected', () => {
    const group = [teig(1, '0301', 208, 1), teig(2, '0301', 208, 2)]
    useStore.getState().toggleGroup(group)
    useStore.getState().toggleGroup(group)
    expect(ids()).toEqual([])
  })

  it('adds the missing ones when the group is only partly selected', () => {
    useStore.getState().toggle(teig(1, '0301', 208, 1))
    useStore.getState().toggleGroup([teig(1, '0301', 208, 1), teig(2, '0301', 208, 2)])
    expect(ids()).toEqual([1, 2])
  })

  it('is a no-op for an empty group', () => {
    useStore.getState().toggle(teig(1, '0301', 208, 1))
    useStore.getState().toggleGroup([])
    expect(ids()).toEqual([1])
  })
})

describe('addTeiger', () => {
  it('dedupes by id, replacing an existing teig in place', () => {
    useStore.getState().addTeiger([teig(1, '0301', 208, 1), teig(2, '0301', 208, 2)])
    // Re-adding id 1 with a different bnr should not grow the list…
    useStore.getState().addTeiger([teig(1, '0301', 208, 9)])
    expect(ids()).toEqual([1, 2])
    // …and should keep the latest value for that id.
    const updated = useStore.getState().selected.find((t) => t.id === 1)
    expect(updated?.props.bruksnummer).toBe(9)
  })
})

describe('removeTeig', () => {
  it('removes only the matching id', () => {
    useStore.getState().addTeiger([teig(1, '0301', 208, 1), teig(2, '0301', 208, 2)])
    useStore.getState().removeTeig(1)
    expect(ids()).toEqual([2])
  })
})

describe('whole-gnr / whole-street flags', () => {
  it('toggleWholeGnr adds then removes a key', () => {
    useStore.getState().toggleWholeGnr('0301-208')
    expect(useStore.getState().wholeGnr).toEqual(['0301-208'])
    useStore.getState().toggleWholeGnr('0301-208')
    expect(useStore.getState().wholeGnr).toEqual([])
  })

  it('toggleWholeAdressekode adds then removes a key', () => {
    useStore.getState().toggleWholeAdressekode('0301-10118')
    expect(useStore.getState().wholeAdressekode).toEqual(['0301-10118'])
    useStore.getState().toggleWholeAdressekode('0301-10118')
    expect(useStore.getState().wholeAdressekode).toEqual([])
  })
})

describe('setComment / setNewValue', () => {
  it('setComment stores per-teig text', () => {
    useStore.getState().setComment(1, 'sjekk grense')
    expect(useStore.getState().comments[1]).toBe('sjekk grense')
  })

  it('setNewValue merges patches for the same row id', () => {
    useStore.getState().setNewValue('row-1', { nyKommunenummer: '3024' })
    useStore.getState().setNewValue('row-1', { nyGardsnummer: 5 })
    expect(useStore.getState().newValues['row-1']).toEqual({
      nyKommunenummer: '3024',
      nyGardsnummer: 5,
    })
  })
})

describe('clearAll', () => {
  it('clears the selection and flags but leaves comments/batch untouched', () => {
    useStore.getState().addTeiger([teig(1, '0301', 208, 1)])
    useStore.getState().toggleWholeGnr('0301-208')
    useStore.getState().setComment(1, 'note')
    useStore.getState().setBatchKommune('3024')

    useStore.getState().clearAll()

    expect(ids()).toEqual([])
    expect(useStore.getState().wholeGnr).toEqual([])
    // clearAll only resets the selection + flags, by design.
    expect(useStore.getState().comments[1]).toBe('note')
    expect(useStore.getState().batchKommune).toBe('3024')
  })
})

describe('startNewList', () => {
  it('drops everything clearAll keeps, and the list it came from', () => {
    useStore.getState().addTeiger([teig(1, '0301', 208, 1)])
    useStore.getState().setComment(1, 'note')
    useStore.getState().setBatchKommune('3024')
    useStore.getState().setNewValue('row-1', { nyBruksnummer: 7 })
    useStore.getState().setCurrentList(7, 'Oslo–Bærum', '2026-10-01 09:30:00+00')

    useStore.getState().startNewList()

    expect(useStore.getState().getWorkingState()).toEqual({
      selected: [],
      comments: {},
      batchKommune: '',
      newValues: {},
      wholeGnr: [],
      wholeAdressekode: [],
    })
    // Without this the next save would overwrite the list just left.
    expect(useStore.getState().currentListId).toBeNull()
    expect(useStore.getState().currentListUpdatedAt).toBeNull()
  })

  it('is not unsaved work, even when it replaced some', () => {
    useStore.getState().addTeiger([teig(1, '0301', 208, 1)])
    expect(useStore.getState().isDirty()).toBe(true)

    useStore.getState().startNewList()

    expect(useStore.getState().isDirty()).toBe(false)
  })
})

describe('isDirty', () => {
  it('is false right after a load and true after the first edit', () => {
    const loaded = {
      ...useStore.getState().getWorkingState(),
      selected: [teig(1, '0301', 208, 1)],
    }
    useStore.getState().applyWorkingState(loaded)
    expect(useStore.getState().isDirty()).toBe(false)

    useStore.getState().setComment(1, 'note')
    expect(useStore.getState().isDirty()).toBe(true)
  })

  it('compares against what was saved, not against what is in the store now', () => {
    useStore.getState().addTeiger([teig(1, '0301', 208, 1)])
    const sent = useStore.getState().getWorkingState()
    useStore.getState().setComment(1, 'written after the save was sent')

    useStore.getState().markSaved(sent)

    expect(useStore.getState().isDirty()).toBe(true)
  })
})

describe('getWorkingState / applyWorkingState', () => {
  it('round-trips the persisted fields', () => {
    useStore.getState().addTeiger([teig(1, '0301', 208, 1)])
    useStore.getState().setComment(1, 'note')
    useStore.getState().setBatchKommune('3024')
    useStore.getState().setNewValue('row-1', { nyBruksnummer: 7 })
    useStore.getState().toggleWholeGnr('0301-208')
    useStore.getState().toggleWholeAdressekode('0301-10118')

    const snapshot = useStore.getState().getWorkingState()

    // Wipe, then restore from the snapshot.
    useStore.getState().clearAll()
    useStore.setState({ comments: {}, batchKommune: '', newValues: {} })
    useStore.getState().applyWorkingState(snapshot)

    expect(ids()).toEqual([1])
    expect(useStore.getState().comments[1]).toBe('note')
    expect(useStore.getState().batchKommune).toBe('3024')
    expect(useStore.getState().newValues['row-1']).toEqual({ nyBruksnummer: 7 })
    expect(useStore.getState().wholeGnr).toEqual(['0301-208'])
    expect(useStore.getState().wholeAdressekode).toEqual(['0301-10118'])
  })

  it('applyWorkingState falls back to empties for missing fields', () => {
    useStore.getState().addTeiger([teig(1, '0301', 208, 1)])
    // A partial blob (e.g. an older saved list) should not carry stale state over.
    // Deliberately partial — cast through unknown since it's missing newer fields.
    useStore.getState().applyWorkingState({ selected: [] } as unknown as WorkingState)
    expect(ids()).toEqual([])
    expect(useStore.getState().batchKommune).toBe('')
    expect(useStore.getState().comments).toEqual({})
  })
})

describe('applyRowGnrOffset / clearRowGnrValues', () => {
  // A grensejustering out of 1525: one single-bnr matrikkelenhet, one flagged whole-gnr, and
  // one teig with no matrikkelnummer — the three id shapes the komreg-liste actually holds.
  const rows = () =>
    buildKomregRows(
      [teig(1, '1525', 1, 3), teig(2, '1525', 58, 1), teig(9, '1525', null, null)],
      {},
      ['1525-58'],
      [],
    )

  // The bug this covers: the patch carries only nyGardsnummer, so spreading it over
  // newValues at the top level replaced the whole row and dropped the hand-typed bnr.
  it('keeps the rest of a hand-typed row', () => {
    useStore.getState().setNewValue('m:1525-1/3', { nyBruksnummer: 7 })
    useStore.getState().applyRowGnrOffset(rows(), 200)
    expect(useStore.getState().newValues['m:1525-1/3']).toEqual({
      nyBruksnummer: 7,
      nyGardsnummer: 201,
    })
  })

  it('shifts both matrikkelenhet id shapes and leaves the teig row alone', () => {
    useStore.getState().applyRowGnrOffset(rows(), 200)
    const nv = useStore.getState().newValues
    expect(nv['m:1525-1/3']?.nyGardsnummer).toBe(201)
    expect(nv['m:1525-58/all']?.nyGardsnummer).toBe(258)
    expect(nv['t:9']).toBeUndefined()
  })

  it('applying twice does not shift a shifted series', () => {
    useStore.getState().applyRowGnrOffset(rows(), 200)
    useStore.getState().applyRowGnrOffset(rows(), 200)
    expect(useStore.getState().newValues['m:1525-1/3']?.nyGardsnummer).toBe(201)
  })

  it('clearRowGnrValues takes back only the gårdsnummer', () => {
    useStore.getState().setNewValue('m:1525-1/3', { nyBruksnummer: 7 })
    useStore.getState().applyRowGnrOffset(rows(), 200)
    useStore.getState().clearRowGnrValues(rows())
    expect(useStore.getState().newValues['m:1525-1/3']).toEqual({
      nyBruksnummer: 7,
      nyGardsnummer: undefined,
    })
  })
})

// The lookups share one contract, stated beside each of them in store.ts: a marker while the
// request is out, the answer when it lands, and on failure the marker gone and the error
// handed back to whoever asked. A marker left behind is a spinner that never stops.
describe('on-demand lookups', () => {
  const adresse = (nummer: number) => ({
    adressetekst: `Gate ${nummer}`,
    adressenavn: 'Gate',
    nummer,
    bokstav: '',
    adressekode: 10118,
    representasjonspunkt: { lon: 1, lat: 2 },
  })
  const failing = (async () => new Response(null, { status: 500 })) as unknown as typeof fetch

  it('checkCoverage marks the street as loading, then stores how many numbers it has', async () => {
    let answer: (r: Response) => void = () => {}
    globalThis.fetch = (() =>
      new Promise<Response>((resolve) => (answer = resolve))) as unknown as typeof fetch

    const done = useStore.getState().checkCoverage('0301', 10118)
    expect(useStore.getState().coverage['0301-10118']).toBe('loading')

    answer(
      Response.json({
        adresser: [adresse(1), adresse(3), adresse(3)],
        metadata: { totaltAntallTreff: 3 },
      }),
    )
    await done

    expect(useStore.getState().coverage['0301-10118']).toBe(2)
  })

  it('checkCoverage drops the marker and hands the error back when the lookup fails', async () => {
    globalThis.fetch = failing

    await expect(useStore.getState().checkCoverage('0301', 10118)).rejects.toThrow()

    expect(useStore.getState().coverage).toEqual({})
  })

  it('checkGnrCoverage and addAllBnr leave no marker behind on failure either', async () => {
    globalThis.fetch = failing

    await expect(useStore.getState().checkGnrCoverage('0301', 208)).rejects.toThrow()
    await expect(useStore.getState().addAllBnr('0301', 208)).rejects.toThrow()

    expect(useStore.getState().gnrCoverage).toEqual({})
    expect(ids()).toEqual([])
  })

  it('runKomregCheck stores the findings with the values they were found for', async () => {
    globalThis.fetch = (async () =>
      Response.json([{ kommunenummer: '0301', kommunenavn: 'Oslo' }])) as unknown as typeof fetch
    useStore.getState().setBatchKommune('9999')
    const rows = buildKomregRows([teig(9, '0301', null, null)], {}, [], [])

    await useStore.getState().runKomregCheck(rows)

    const check = useStore.getState().komregCheck
    expect(check.status).toBe('done')
    expect(check.issues.some((i) => i.level === 'error' && i.rowId === rows[0].id)).toBe(true)
    expect(check.snapshot).not.toBe('')
  })

  // A partial result would read as an all-clear on every row whose lookup never landed.
  it('runKomregCheck keeps nothing from a run that failed', async () => {
    globalThis.fetch = failing
    const rows = buildKomregRows([teig(9, '0301', null, null)], {}, [], [])

    await expect(useStore.getState().runKomregCheck(rows)).rejects.toThrow()

    expect(useStore.getState().komregCheck).toEqual({ status: 'idle', issues: [], snapshot: '' })
  })
})
