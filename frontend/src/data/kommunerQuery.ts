import { queryOptions } from '@tanstack/react-query'
import { fetchKommuner } from './external'

// Kommunenummer → kommunenavn, for showing a name beside a number. Defined once so the
// komreg-liste and the parameterfil review share one fetch. `staleTime: Infinity` because
// the list is fixed for a session (and for a year at a time in reality).
export const kommunerQuery = queryOptions({
  queryKey: ['kommuner'],
  queryFn: fetchKommuner,
  staleTime: Infinity,
})
