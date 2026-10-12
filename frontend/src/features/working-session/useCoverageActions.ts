import { useStore } from './store'

// The store's on-demand fetch actions, paired with the feedback they deliberately don't own:
// each clears its 'loading' marker and rethrows, leaving the message to whoever
// triggered it. Wrapped here so the map shell and the arbeidsliste can't drift apart
// on the wording, and kept out of store.ts so the store holds state and says nothing to
// the user. Consumers that need the resolved value (MapView's matrikkel search
// awaits the teig group) still call the raw store action instead.
export function useCoverageActions() {
  const checkCoverage = useStore((s) => s.checkCoverage)
  const checkGnrCoverage = useStore((s) => s.checkGnrCoverage)
  const addAllBnr = useStore((s) => s.addAllBnr)
  return {
    onCheckCoverage: (kommunenummer: string | null, adressekode: number) =>
      void checkCoverage(kommunenummer, adressekode).catch((e: unknown) => {
        console.error('coverage check failed', e)
        window.alert('Kunne ikke sjekke dekning')
      }),
    onCheckGnrCoverage: (kommunenummer: string | null, gardsnummer: number) =>
      void checkGnrCoverage(kommunenummer, gardsnummer).catch((e: unknown) => {
        console.error('gnr coverage check failed', e)
        window.alert('Kunne ikke sjekke dekning for gårdsnummeret')
      }),
    onAddAllBnr: (kommunenummer: string | null, gardsnummer: number) =>
      void addAllBnr(kommunenummer, gardsnummer).catch((e: unknown) => {
        console.error('addAllBnr failed', e)
        window.alert('Kunne ikke hente bruksnumre')
      }),
  }
}
