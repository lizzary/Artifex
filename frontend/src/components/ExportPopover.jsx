import { useEffect, useLayoutEffect, useRef, useState } from 'react'

const gutter = 10
const seam = 1

export default function Popover({
  open, anchorRef, onDismiss, className = '', id, minWidth = 0, maxWidth = Infinity,
  matchWidth = true, align = 'start', children,
}) {
  const ref = useRef(null)
  const [present, setPresent] = useState(open)
  const dismiss = useRef(onDismiss)
  useLayoutEffect(() => { dismiss.current = onDismiss }, [onDismiss])

  if (open && !present) setPresent(true)

  useEffect(() => {
    if (open || !present) return
    const anchor = anchorRef.current
    const timeout = window.setTimeout(() => {
      if (anchor) delete anchor.dataset.popoverSide
      setPresent(false)
    }, 180)
    return () => window.clearTimeout(timeout)
  }, [open, present, anchorRef])

  useLayoutEffect(() => {
    if (!open) return
    const panel = ref.current
    const anchor = anchorRef.current
    if (!anchor) return
    const scrollParents = []
    for (let parent = anchor.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY)) scrollParents.push(parent)
    }

    function place() {
      const bounds = anchor.getBoundingClientRect()
      const viewport = window.visualViewport
      const leftEdge = (viewport?.offsetLeft ?? 0) + gutter
      const topEdge = (viewport?.offsetTop ?? 0) + gutter
      const rightEdge = leftEdge + (viewport?.width ?? document.documentElement.clientWidth) - 2 * gutter
      const bottomEdge = topEdge + (viewport?.height ?? document.documentElement.clientHeight) - 2 * gutter
      const clip = scrollParents.reduce(({ top, bottom }, parent) => {
        const area = parent.getBoundingClientRect()
        return { top: Math.max(top, area.top), bottom: Math.min(bottom, area.bottom) }
      }, { top: topEdge, bottom: bottomEdge })
      const above = bounds.top >= clip.top && bounds.top < clip.bottom ? bounds.top - topEdge + seam : 0
      const below = bounds.bottom <= clip.bottom && bounds.bottom > clip.top ? bottomEdge - bounds.bottom + seam : 0
      if (!above && !below) {
        dismiss.current?.('anchor-hidden')
        return
      }

      const width = Math.min(rightEdge - leftEdge, maxWidth, Math.max(minWidth, matchWidth ? bounds.width : 0))
      if (width > 0) panel.style.width = `${width}px`
      const panelWidth = panel.getBoundingClientRect().width
      const left = align === 'end' ? bounds.right - panelWidth : bounds.left
      const panelLeft = Math.max(leftEdge, Math.min(left, rightEdge - panelWidth))
      const desiredHeight = Math.min(400, panel.scrollHeight + 2)
      const flip = below < desiredHeight && above > below
      panel.style.setProperty('--popover-available-height', `${Math.max(0, flip ? above : below)}px`)
      panel.style.left = `${panelLeft}px`
      panel.style.top = flip ? 'auto' : `${bounds.bottom - seam}px`
      panel.style.bottom = flip ? `${document.documentElement.clientHeight - bounds.top - seam}px` : 'auto'
      const side = flip ? 'above' : 'below'
      panel.dataset.placement = side
      panel.toggleAttribute('data-join-start', Math.abs(panelLeft - bounds.left) < 1)
      panel.toggleAttribute('data-join-end', Math.abs(panelLeft + panelWidth - bounds.right) < 1)
      anchor.dataset.popoverSide = side
    }

    function onScroll(event) {
      if (!panel.contains(event.target)) place()
    }

    panel.showPopover()
    place()
    const resize = new ResizeObserver(place)
    resize.observe(anchor)
    const dialog = anchor.closest('dialog')
    if (dialog) resize.observe(dialog)
    dialog?.addEventListener('animationend', place)
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', place)
    window.visualViewport?.addEventListener('resize', place)
    window.visualViewport?.addEventListener('scroll', place)
    return () => {
      if (panel.matches(':popover-open')) panel.hidePopover()
      resize.disconnect()
      dialog?.removeEventListener('animationend', place)
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', place)
      window.visualViewport?.removeEventListener('resize', place)
      window.visualViewport?.removeEventListener('scroll', place)
    }
  }, [open, anchorRef, minWidth, maxWidth, matchWidth, align])

  useEffect(() => {
    if (!open) return
    function dismissOutside(event) {
      if (!anchorRef.current?.contains(event.target) && !ref.current?.contains(event.target)) dismiss.current?.('outside')
    }
    function dismissOnFocusIn(event) {
      // Clicking a non-focusable part of the panel can give focus to its enclosing dialog.
      if (!event.target.contains(ref.current)) dismissOutside(event)
    }
    function dismissOnEscape(event) {
      if (event.key !== 'Escape' || event.isComposing || !ref.current?.matches(':popover-open')) return
      event.preventDefault()
      event.stopPropagation()
      dismiss.current?.('escape')
    }
    document.addEventListener('pointerdown', dismissOutside, true)
    document.addEventListener('focusin', dismissOnFocusIn)
    document.addEventListener('keydown', dismissOnEscape, true)
    return () => {
      document.removeEventListener('pointerdown', dismissOutside, true)
      document.removeEventListener('focusin', dismissOnFocusIn)
      document.removeEventListener('keydown', dismissOnEscape, true)
    }
  }, [open, anchorRef])

  return <div ref={ref} id={id} className={`export-popover ${className}`} popover="manual" inert={!open}>
    {present && children}
  </div>
}
