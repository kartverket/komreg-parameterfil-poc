import { queryOptions, type QueryClient } from '@tanstack/react-query'
import { getList, listLists } from './lists'

// The saved lists as server state: one spelling of each key, and one place that says what
// a write makes stale. A key typed out where it is used is how a write ends up refreshing
// the index and leaving the list itself cached.

/** The index: id, name and timestamps of every list. */
export const listsQuery = queryOptions({ queryKey: ['lists', 'index'], queryFn: listLists })

/**
 * One list with its working-state blob.
 *
 * `staleTime: Infinity` because nothing but our own writes changes it, and those go through
 * the two functions below. Not used for opening a list or generating a parameterfil: both
 * read the list straight from the backend, where a cached copy would be the wrong one.
 */
export const listQuery = (id: number) =>
  queryOptions({
    queryKey: ['lists', 'detail', id],
    queryFn: () => getList(id),
    staleTime: Infinity,
  })

/** After a list was created or updated: its name, timestamp and contents have all moved. */
export function listSaved(queryClient: QueryClient, id: number) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: listsQuery.queryKey }),
    queryClient.invalidateQueries({ queryKey: listQuery(id).queryKey }),
  ])
}

/** After a list was deleted. Removed, not invalidated: there is nothing left to refetch. */
export function listDeleted(queryClient: QueryClient, id: number) {
  queryClient.removeQueries({ queryKey: listQuery(id).queryKey })
  return queryClient.invalidateQueries({ queryKey: listsQuery.queryKey })
}
