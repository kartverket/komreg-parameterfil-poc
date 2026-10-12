import { buildKomregRows } from '@/domain/komreg'
import { assignTeigAddresses } from './map/teigAddresses'
import { useAddresses } from '@/data/useAddresses'
import { useStore, useSortedSelected } from './store'

// Derived views over the working session: addresses, per-teig address assignment, and the
// komreg rows. Shared by the map shell and the routed overlay pages so the derivation lives
// in one place, not in MapView's props.
//
// The komreg parameterfil is NOT built here: it is produced per saved list on the
// regulering page (useRegulering.ts), which reads the list from the backend rather
// than the store.
export function useExports() {
  const selected = useStore((s) => s.selected)
  const sortedSelected = useSortedSelected()
  const wholeGnr = useStore((s) => s.wholeGnr)
  const wholeAdressekode = useStore((s) => s.wholeAdressekode)
  const { addresses, failed: addressesFailed } = useAddresses(selected)

  const teigAddresses = assignTeigAddresses(selected, addresses)
  const komregRows = buildKomregRows(sortedSelected, addresses, wholeGnr, wholeAdressekode)

  // True while any address lookup is still in flight — separate from exportBlocked
  // because the UI shows it as its own "henter adresser…" hint.
  const addressesLoading = Object.values(addresses).some((a) => a === 'loading')

  // Same reasoning for a *failed* lookup, except it never resolves on its own: the rows
  // would be missing with nothing left in flight to explain why. Acting on the rows in
  // either state silently drops address/vegadresse rows, so KomregTable gates the move
  // check and the regulering link on this; ArbeidslisteView surfaces the two states.
  const exportBlocked = addressesLoading || addressesFailed

  return {
    addresses,
    addressesLoading,
    addressesFailed,
    exportBlocked,
    sortedSelected,
    teigAddresses,
    komregRows,
  }
}
