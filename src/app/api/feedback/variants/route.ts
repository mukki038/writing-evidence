import { handleVariants } from '@/lib/feedback/handlers'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export function POST(req: Request) {
  return handleVariants(req)
}
