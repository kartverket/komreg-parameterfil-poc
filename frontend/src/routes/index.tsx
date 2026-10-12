import { createFileRoute } from '@tanstack/react-router'
import { LandingScreen } from '@/features/working-session/LandingScreen'

export const Route = createFileRoute('/')({ component: LandingScreen })
