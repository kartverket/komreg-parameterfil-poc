import { createFileRoute } from '@tanstack/react-router'
import { ReguleringView } from '@/features/reguleringer/ReguleringView'

export const Route = createFileRoute('/reguleringer/$reguleringId')({
  component: ReguleringDetail,
})

function ReguleringDetail() {
  // A path param is always a string. A non-numeric one becomes NaN, the backend answers
  // 400, and the page says the regulering could not be fetched.
  const { reguleringId } = Route.useParams()
  return <ReguleringView id={Number(reguleringId)} />
}
