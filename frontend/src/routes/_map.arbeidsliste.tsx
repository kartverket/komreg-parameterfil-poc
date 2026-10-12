import { createFileRoute } from '@tanstack/react-router'
import { ArbeidslisteView } from '@/features/working-session/ArbeidslisteView'

export const Route = createFileRoute('/_map/arbeidsliste')({ component: ArbeidslisteView })
