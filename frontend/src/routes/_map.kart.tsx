import { createFileRoute } from '@tanstack/react-router'

// The bare map: the shell renders everything, so this route adds nothing on top of it.
export const Route = createFileRoute('/_map/kart')({ component: () => null })
