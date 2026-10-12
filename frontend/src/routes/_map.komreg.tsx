import { createFileRoute } from '@tanstack/react-router'
import { KomregTable } from '@/features/working-session/KomregTable'

export const Route = createFileRoute('/_map/komreg')({ component: KomregTable })
