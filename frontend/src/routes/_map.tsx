import { createFileRoute } from '@tanstack/react-router'
import MapView from '@/features/working-session/MapView'

// The map layout is *pathless* (the leading underscore), which is what keeps MapView mounted
// across /kart → /arbeidsliste → /komreg: navigating between children of one layout route
// never remounts the layout. That matters — remounting the map would throw away zoom, centre
// and the drawn overlays on every tab switch.
//
// Going back to `/` *does* unmount it, which is correct: choosing what to work on happens
// outside a work session, and the landing screen shouldn't sit on top of a live map that has
// already initialised OpenLayers and started fetching tiles. Nothing is lost by the unmount —
// the working state lives in the module-level store, not in the component tree.
export const Route = createFileRoute('/_map')({ component: MapView })
