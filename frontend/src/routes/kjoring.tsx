import { createFileRoute } from '@tanstack/react-router'
import { KjoringView } from '@/features/kjoring/KjoringView'

// Top-level: this reads komreg-backend rather than any working session, and a kjøring is
// something you check on, not something you do inside a map session.
export const Route = createFileRoute('/kjoring')({ component: KjoringView })
