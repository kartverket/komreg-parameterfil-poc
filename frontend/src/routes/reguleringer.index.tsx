import { createFileRoute } from '@tanstack/react-router'
import { ReguleringOverview } from '@/features/reguleringer/ReguleringOverview'

// Top-level, not inside the map layout: saved reguleringer read saved lists and no live
// working session, so they never belonged to a map session.
export const Route = createFileRoute('/reguleringer/')({ component: ReguleringOverview })
