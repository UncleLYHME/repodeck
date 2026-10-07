// Small motion helpers. Everything here degrades to no motion under prefers-reduced-motion.

import { useEffect, useRef, useState, type ReactNode } from 'react'

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Spin while `active`, then finish the current turn instead of snapping back.
 * Spread the returned props on the spinning element.
 */
export function useSpin(active: boolean): { className: string; onAnimationIteration: () => void } {
  const [spinning, setSpinning] = useState(active)
  const activeRef = useRef(active)
  activeRef.current = active
  useEffect(() => {
    if (active) setSpinning(true)
    else if (reduced()) setSpinning(false) // no turns to finish
  }, [active])
  return {
    className: spinning ? 'spin-soft' : '',
    onAnimationIteration: () => {
      if (!activeRef.current) setSpinning(false)
    },
  }
}

/** A short scale pulse whenever `value` changes after the first render (counts, branch names). */
export function Bump({ value, children, className = '' }: { value: unknown; children: ReactNode; className?: string }) {
  const first = useRef(true)
  const [n, setN] = useState(0)
  const key = JSON.stringify(value)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    setN((x) => x + 1)
  }, [key])
  return <span key={n} className={`${n ? 'bump' : ''} inline-flex ${className}`}>{children}</span>
}
