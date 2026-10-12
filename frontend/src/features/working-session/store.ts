import { create } from 'zustand'
import {
  type SelectedTeig,
  type NewValues,
  type WorkingState,
  type KomregRow,
  compareMatrikkel,
  adressekodeKey,
  gnrCoverageKey,
} from '@/domain/domain'
import { fetchGnrTeiger, fetchAdressekodeNumbers, fetchGnrBnr } from '@/data/external'
import { clearedRowGnrValues, rowGnrOffsetValues } from '@/domain/komreg'
import { type KomregIssue, checkKomreg, checkSnapshot } from '@/checks/validate'

type CoverageMap = Record<string, number | 'loading'>

// Result of the komreg move check. `snapshot` records the values it ran against so the UI
// can tell a current result from one the user has since edited past; 'idle' means never run.
export interface KomregCheck {
  status: 'idle' | 'running' | 'done'
  issues: KomregIssue[]
  snapshot: string
}

// The working session: the selection plus every decision made over it (whole-gnr
// / whole-street flags, comments, move-target values) and which saved list is
// loaded. This is the state the map shell and the routed overlay pages all share,
// so it lives in one store rather than being prop-drilled through MapView.
// Server state (addresses) stays in TanStack Query; ephemeral shell UI (panel
// visibility, draw mode, search box, right-click info) stays local to MapView.
interface WorkingStore {
  selected: SelectedTeig[]
  // gnrKey()s flagged "move all bnr"; adressekodeKey()s flagged "move whole street".
  wholeGnr: string[]
  wholeAdressekode: string[]
  // Free-text comment per teig (lokalid); batch move-target kommune; per-row overrides.
  comments: Record<number, string>
  batchKommune: string
  newValues: Record<string, NewValues>
  // Distinct house-numbers per street / distinct bnr per gnr — fetched on demand,
  // 'loading' while in flight. Not persisted.
  coverage: CoverageMap
  gnrCoverage: CoverageMap
  // Outcome of the last komreg move check. Not persisted — it describes the registers at
  // one moment, and a saved list reopened next week must not show last week's all-clear.
  komregCheck: KomregCheck
  // Counts every time the whole working state is replaced (a list opened, a new one
  // started). A save that answers after that belongs to a session that is gone.
  sessionId: number
  // Which saved list is being edited (null = unsaved working set).
  currentListId: number | null
  currentListName: string | null
  // The loaded list's updatedAt — the version a save says it was edited from.
  currentListUpdatedAt: string | null

  // Selection mutators (the map clicks, the search box, the arbeidsliste share these).
  toggle: (item: SelectedTeig) => void
  toggleGroup: (items: SelectedTeig[]) => void
  addTeiger: (items: SelectedTeig[]) => void
  removeTeig: (id: number) => void
  setSelected: (items: SelectedTeig[]) => void
  toggleWholeGnr: (key: string) => void
  toggleWholeAdressekode: (key: string) => void

  // Shift the gårdsnummer of the komreg rows by a round number, to clear the numbers the
  // target kommune already uses. Takes the rows because they are derived in useExports,
  // not held here — the same reason runKomregCheck does.
  applyRowGnrOffset: (rows: KomregRow[], offset: number) => void
  clearRowGnrValues: (rows: KomregRow[]) => void

  setComment: (id: number, text: string) => void
  setBatchKommune: (v: string) => void
  setNewValue: (id: string, patch: NewValues) => void

  // Look up how many house numbers a street has (coverage check).
  checkCoverage: (kommunenummer: string | null, adressekode: number) => Promise<void>
  // Count the bnr in a gnr-serie without touching the selection (coverage check).
  checkGnrCoverage: (kommunenummer: string | null, gardsnummer: number) => Promise<void>
  // Enumerate every bnr in a gnr-serie via the Teig WFS and add them all.
  addAllBnr: (kommunenummer: string | null, gardsnummer: number) => Promise<SelectedTeig[]>
  // Check every row's move target against the address register and the eiendomskart.
  runKomregCheck: (rows: KomregRow[]) => Promise<void>

  clearAll: () => void
  // Full reset for "Ny grensejustering" — see the implementation for why clearAll
  // isn't enough.
  startNewList: () => void
  setCurrentList: (id: number | null, name: string | null, updatedAt: string | null) => void
  getWorkingState: () => WorkingState
  applyWorkingState: (d: WorkingState) => void

  // Unsaved-work tracking: the JSON of the working state as of the last save/load
  // (or empty at startup). isDirty compares against it so the shell can warn before
  // the work would be lost (tab close, loading another list).
  savedSnapshot: string
  markSaved: (saved: WorkingState) => void
  isDirty: () => boolean
}

const EMPTY_WORKING_STATE: WorkingState = {
  selected: [],
  comments: {},
  batchKommune: '',
  newValues: {},
  wholeGnr: [],
  wholeAdressekode: [],
}

// Apply a per-row patch on top of the existing newValues, merging each row's fields rather
// than replacing the row. The patches here set one field; everything else on the row was
// typed by hand and has to survive.
function mergeNewValues(
  current: Record<string, NewValues>,
  patch: Record<string, NewValues>,
): Record<string, NewValues> {
  const out = { ...current }
  for (const [id, v] of Object.entries(patch)) out[id] = { ...out[id], ...v }
  return out
}

export const useStore = create<WorkingStore>((set, get) => ({
  selected: [],
  wholeGnr: [],
  wholeAdressekode: [],
  comments: {},
  batchKommune: '',
  newValues: {},
  coverage: {},
  gnrCoverage: {},
  komregCheck: { status: 'idle', issues: [], snapshot: '' },
  sessionId: 0,
  currentListId: null,
  currentListName: null,
  currentListUpdatedAt: null,

  toggle: (item) =>
    set((s) => ({
      selected: s.selected.some((t) => t.id === item.id)
        ? s.selected.filter((t) => t.id !== item.id)
        : [...s.selected, item],
    })),

  toggleGroup: (items) => {
    if (!items.length) return
    set((s) => {
      const ids = new Set(items.map((i) => i.id))
      const allIn = items.every((i) => s.selected.some((t) => t.id === i.id))
      if (allIn) return { selected: s.selected.filter((t) => !ids.has(t.id)) }
      const byId = new globalThis.Map(s.selected.map((t) => [t.id, t]))
      for (const it of items) byId.set(it.id, it)
      return { selected: [...byId.values()] }
    })
  },

  addTeiger: (items) =>
    set((s) => {
      const byId = new globalThis.Map(s.selected.map((t) => [t.id, t]))
      for (const it of items) byId.set(it.id, it)
      return { selected: [...byId.values()] }
    }),

  removeTeig: (id) => set((s) => ({ selected: s.selected.filter((t) => t.id !== id) })),

  setSelected: (items) => set({ selected: items }),

  toggleWholeGnr: (key) =>
    set((s) => ({
      wholeGnr: s.wholeGnr.includes(key)
        ? s.wholeGnr.filter((k) => k !== key)
        : [...s.wholeGnr, key],
    })),

  toggleWholeAdressekode: (key) =>
    set((s) => ({
      wholeAdressekode: s.wholeAdressekode.includes(key)
        ? s.wholeAdressekode.filter((k) => k !== key)
        : [...s.wholeAdressekode, key],
    })),

  setComment: (id, text) => set((s) => ({ comments: { ...s.comments, [id]: text } })),

  setBatchKommune: (v) => set({ batchKommune: v }),

  setNewValue: (id, patch) =>
    set((s) => ({ newValues: { ...s.newValues, [id]: { ...s.newValues[id], ...patch } } })),

  checkCoverage: async (kommunenummer, adressekode) => {
    const key = adressekodeKey(kommunenummer, adressekode)
    set((s) => ({ coverage: { ...s.coverage, [key]: 'loading' } }))
    try {
      const nums = await fetchAdressekodeNumbers(kommunenummer, adressekode)
      set((s) => ({ coverage: { ...s.coverage, [key]: nums.size } }))
    } catch (e) {
      // Clear the 'loading' marker and rethrow — the caller owns user feedback
      // (same contract as addAllBnr).
      set((s) => {
        const next = { ...s.coverage }
        delete next[key]
        return { coverage: next }
      })
      throw e
    }
  },

  // "Do I already hold every bnr in this serie?" — the question behind the whole-gnr
  // flag, answered without changing the selection. addAllBnr fills the same map, but
  // only as a side effect of adding all of them, which is a different decision: you
  // check first, then decide whether to flag it, add the rest, or leave it alone.
  // Same fetch as the komreg check's occupancy lookup, so they share the query.
  checkGnrCoverage: async (kommunenummer, gardsnummer) => {
    const key = gnrCoverageKey(kommunenummer, gardsnummer)
    set((s) => ({ gnrCoverage: { ...s.gnrCoverage, [key]: 'loading' } }))
    try {
      const bnr = await fetchGnrBnr(kommunenummer ?? '', gardsnummer)
      set((s) => ({ gnrCoverage: { ...s.gnrCoverage, [key]: bnr.size } }))
    } catch (e) {
      // Same contract as checkCoverage/addAllBnr: clear the marker, rethrow, let the
      // caller own the message.
      set((s) => {
        const next = { ...s.gnrCoverage }
        delete next[key]
        return { gnrCoverage: next }
      })
      throw e
    }
  },

  addAllBnr: async (kommunenummer, gardsnummer) => {
    const key = gnrCoverageKey(kommunenummer, gardsnummer)
    set((s) => ({ gnrCoverage: { ...s.gnrCoverage, [key]: 'loading' } }))
    try {
      const group = await fetchGnrTeiger(kommunenummer ?? '', gardsnummer)
      get().addTeiger(group)
      const bnr = new Set(group.map((t) => t.props.bruksnummer ?? 0)).size
      set((s) => ({ gnrCoverage: { ...s.gnrCoverage, [key]: bnr } }))
      return group
    } catch (e) {
      set((s) => {
        const next = { ...s.gnrCoverage }
        delete next[key]
        return { gnrCoverage: next }
      })
      throw e
    }
  },

  // Both helpers recompute from each row's own gårdsnummer, so applying twice is a no-op
  // rather than a second shift.
  //
  // Merged **per row**, not by spreading the patch over newValues: the patch carries only
  // nyGardsnummer, so a top-level spread would replace the whole row object and take a
  // hand-typed nyBruksnummer / nyKommunenummer with it.
  applyRowGnrOffset: (rows, offset) =>
    set((s) => ({ newValues: mergeNewValues(s.newValues, rowGnrOffsetValues(rows, offset)) })),

  clearRowGnrValues: (rows) =>
    set((s) => ({
      newValues: mergeNewValues(s.newValues, clearedRowGnrValues(rows, s.newValues)),
    })),

  runKomregCheck: async (rows) => {
    const { batchKommune, newValues } = get()
    set({ komregCheck: { status: 'running', issues: [], snapshot: '' } })
    try {
      const issues = await checkKomreg(rows, batchKommune, newValues)
      set({
        komregCheck: {
          status: 'done',
          issues,
          snapshot: checkSnapshot(rows, batchKommune, newValues),
        },
      })
    } catch (e) {
      // A partial result would read as an all-clear on every row whose lookup never
      // landed, so drop the whole run. Same contract as checkCoverage/addAllBnr: clear
      // the in-flight marker and rethrow, the caller owns the user feedback.
      set({ komregCheck: { status: 'idle', issues: [], snapshot: '' } })
      throw e
    }
  },

  clearAll: () => set({ selected: [], wholeGnr: [], wholeAdressekode: [] }),

  // Start from nothing. Not clearAll: that drops the selection but leaves comments,
  // batchKommune and the per-row overrides behind, which is right for "Fjern alle"
  // (you're re-picking teiger in the same job) and wrong for a new list. Going through
  // applyWorkingState also resets the dirty baseline — an empty new list is not
  // unsaved work — and dropping the current-list reference makes the next save create
  // a list rather than overwrite the one you just left.
  startNewList: () => {
    get().applyWorkingState(EMPTY_WORKING_STATE)
    set({ currentListId: null, currentListName: null, currentListUpdatedAt: null })
  },

  setCurrentList: (id, name, updatedAt) =>
    set({ currentListId: id, currentListName: name, currentListUpdatedAt: updatedAt }),

  getWorkingState: () => {
    const { selected, comments, batchKommune, newValues } = get()
    const { wholeGnr, wholeAdressekode } = get()
    return {
      selected,
      comments,
      batchKommune,
      newValues,
      wholeGnr,
      wholeAdressekode,
    }
  },

  applyWorkingState: (d) => {
    // Same key order as getWorkingState, so the snapshot comparison in isDirty
    // can be a plain string equality.
    const next: WorkingState = {
      selected: d.selected ?? [],
      comments: d.comments ?? {},
      batchKommune: d.batchKommune ?? '',
      newValues: d.newValues ?? {},
      wholeGnr: d.wholeGnr ?? [],
      wholeAdressekode: d.wholeAdressekode ?? [],
    }
    set((s) => ({ ...next, savedSnapshot: JSON.stringify(next), sessionId: s.sessionId + 1 }))
  },

  savedSnapshot: JSON.stringify(EMPTY_WORKING_STATE),

  // Takes what was written rather than reading the store: a save takes a moment, and an
  // edit made meanwhile was not in the request, so it has to stay dirty.
  markSaved: (saved) => set({ savedSnapshot: JSON.stringify(saved) }),

  isDirty: () => JSON.stringify(get().getWorkingState()) !== get().savedSnapshot,
}))

// Selection sorted by matrikkelnummer for display/export (insertion order is kept
// in `selected`).
export function useSortedSelected() {
  const selected = useStore((s) => s.selected)
  return [...selected].sort(compareMatrikkel)
}
