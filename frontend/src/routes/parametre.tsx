import { createFileRoute } from '@tanstack/react-router'
import { ParametreView } from '@/features/parametre/ParametreView'

// Static prose, so top-level for the plainest reason of all: it reads no working session and
// no server state, and hanging it under the map layout would mount OpenLayers to render text.
export const Route = createFileRoute('/parametre')({ component: ParametreView })
