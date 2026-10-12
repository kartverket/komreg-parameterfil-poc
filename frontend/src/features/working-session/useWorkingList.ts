import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { erKode } from '@/data/http'
import { getList, saveList, updateList } from '@/data/lists'
import { listSaved } from '@/data/listQueries'
import { type WorkingState, workingStateSchema } from '@/domain/domain'
import { useStore } from './store'

// Saved-list persistence: save / save-as-new / load against the backend. The
// working state itself lives in the store; this hook just snapshots it for a save
// and writes a loaded list back, tracking which list is current (also in the store).
export function useWorkingList() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [saveStatus, setSaveStatus] = useState('')

  const currentListId = useStore((s) => s.currentListId)
  const currentListName = useStore((s) => s.currentListName)
  const currentListUpdatedAt = useStore((s) => s.currentListUpdatedAt)
  const getWorkingState = useStore((s) => s.getWorkingState)
  const applyWorkingState = useStore((s) => s.applyWorkingState)
  const setCurrentList = useStore((s) => s.setCurrentList)
  const markSaved = useStore((s) => s.markSaved)

  function flashStatus(msg: string) {
    setSaveStatus(msg)
    window.setTimeout(() => setSaveStatus(''), 2500)
  }

  // Save the working state: update the loaded list in place (id set) or create a
  // new one (id null). Resolves to the list's id and new version so onSuccess can mark
  // it current — the version is what the next save has to present.
  const save = useMutation({
    mutationFn: async (v: {
      id: number | null
      expectedUpdatedAt: string | null
      name: string
      data: WorkingState
      sessionId: number
    }) =>
      v.id != null && v.expectedUpdatedAt != null
        ? { id: v.id, updatedAt: await updateList(v.id, v.name, v.data, v.expectedUpdatedAt) }
        : saveList(v.name, v.data),
    onSuccess: ({ id, updatedAt }, v) => {
      void listSaved(queryClient, id)
      // Another list was opened, or a new one started, while this was under way. The save
      // is written, but its id and version belong to the list that was left: adopting them
      // here would make the next save overwrite that list with this one's contents.
      if (useStore.getState().sessionId !== v.sessionId) return
      setCurrentList(id, v.name, updatedAt)
      markSaved(v.data)
      flashStatus(v.id != null ? `Oppdatert «${v.name}»` : `Lagret «${v.name}»`)
    },
    onError: (e) => {
      console.error('save list failed', e)
      // Nothing was written. The edits are still in this tab, so say how to keep them
      // rather than offering to overwrite the newer save.
      if (erKode(e, 'endret-siden-lasting')) {
        window.alert(
          `${e.message}\n\nEndringene dine er ikke lagret. Last grensejusteringen på nytt ` +
            'fra forsiden og gjør dem der, så ingen andres lagring blir overskrevet.',
        )
        return
      }
      window.alert('Kunne ikke lagre grensejusteringen (kjører backend + database?)')
    },
  })

  // Update the loaded list in place; a list that has never been saved prompts for a name
  // first. There is no save-as-copy: which list you are on changes at the top level only,
  // so a fork mid-session would be a second place to do the same thing.
  function saveCurrent() {
    const data = getWorkingState()
    const { sessionId } = useStore.getState()
    if (currentListId != null) {
      save.mutate({
        id: currentListId,
        expectedUpdatedAt: currentListUpdatedAt,
        name: currentListName ?? 'Grensejustering',
        data,
        sessionId,
      })
      return
    }
    const name = window.prompt('Navn på grensejusteringen:')?.trim()
    if (!name) return
    save.mutate({ id: null, expectedUpdatedAt: null, name, data, sessionId })
  }

  async function loadList(id: number) {
    // Loading replaces the whole working state — don't silently discard edits.
    if (
      useStore.getState().isDirty() &&
      !window.confirm('Du har ulagrede endringer. Erstatte dem?')
    ) {
      return
    }
    let full
    try {
      full = await getList(id)
    } catch (e) {
      console.error('load list failed', e)
      window.alert('Kunne ikke hente grensejusteringen (kjører backend + database?)')
      return
    }
    // Validate/normalise the opaque blob: defaults fill fields older lists lack. Kept
    // out of the fetch's catch — a stored blob that no longer matches the schema is a
    // different problem from an unreachable backend, and saying so saves the guesswork.
    let data
    try {
      data = workingStateSchema.parse(full.data) as WorkingState
    } catch (e) {
      console.error('saved list failed validation', e)
      window.alert('Grensejusteringen kunne ikke leses — lagret format stemmer ikke.')
      return
    }
    applyWorkingState(data)
    setCurrentList(full.id, full.name, full.updatedAt)
    void navigate({ to: '/kart' })
  }

  return { saveStatus, saveCurrent, loadList }
}
