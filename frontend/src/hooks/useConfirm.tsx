import { useCallback, useRef, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

export interface ConfirmOptions {
  title: string
  /** Body text. Blank lines are rendered as paragraphs, so callers keep writing prose. */
  body?: string
  confirmLabel?: string
  cancelLabel?: string
}

// A promise-shaped replacement for window.confirm, so the async pick flows keep reading
// `if (!(await confirm(...))) return` instead of being turned inside out into callbacks.
//
// window.confirm blocked the entire tab, could not be styled, and rendered a bare OS
// dialog in the middle of a dark map UI. It also silently truncates long text in some
// browsers, which mattered here — these confirms carry the counts and the wait time.
//
// The resolver lives in a ref rather than in state: it must not trigger a render, and
// exactly one call is ever in flight (the dialog is modal).
export function useConfirm(): {
  confirm: (options: ConfirmOptions) => Promise<boolean>
  dialog: React.ReactNode
} {
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  const resolve = useRef<((ok: boolean) => void) | null>(null)

  const confirm = useCallback((next: ConfirmOptions) => {
    setOptions(next)
    return new Promise<boolean>((r) => {
      resolve.current = r
    })
  }, [])

  // Radix fires onOpenChange(false) for Escape and overlay-dismiss as well as the two
  // buttons, so settling here covers every way out — a dismissed dialog is a "no", the
  // same as window.confirm.
  function settle(ok: boolean) {
    setOptions(null)
    resolve.current?.(ok)
    resolve.current = null
  }

  const dialog = (
    <AlertDialog open={options != null} onOpenChange={(open) => !open && settle(false)}>
      {options && (
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{options.title}</AlertDialogTitle>
            {options.body && (
              <AlertDialogDescription asChild>
                <div className="flex flex-col gap-2">
                  {options.body.split('\n\n').map((para, i) => (
                    <p key={i}>{para}</p>
                  ))}
                </div>
              </AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => settle(false)}>
              {options.cancelLabel ?? 'Avbryt'}
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => settle(true)}>
              {options.confirmLabel ?? 'Legg til'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      )}
    </AlertDialog>
  )

  return { confirm, dialog }
}
