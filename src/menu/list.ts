// A focusable list of buttons driven by arrows + Enter/Space or the mouse.
import { isSelectKey, moveFocus } from './nav'

export interface MenuList {
  readonly element: HTMLElement
  /** Feed a keydown; returns true when the key was used. */
  key(code: string): boolean
  focus(index: number): void
}

export function menuList(items: { label: string; action: () => void }[], cls = 'menu-list', itemCls = 'menu-item', make?: (i: number) => HTMLElement): MenuList {
  const element = document.createElement('div')
  element.className = cls
  const buttons = items.map((it, i) => {
    const b = make ? make(i) : Object.assign(document.createElement('button'), { textContent: it.label })
    b.classList.add(itemCls)
    b.addEventListener('mouseenter', () => focus(i))
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      it.action()
    })
    element.append(b)
    return b
  })
  let index = 0
  const focus = (i: number) => {
    index = i
    buttons.forEach((b, j) => b.classList.toggle('menu-focus', j === i))
  }
  focus(0)
  return {
    element,
    focus,
    key(code) {
      if (isSelectKey(code)) {
        items[index]?.action()
        return true
      }
      const next = moveFocus(index, items.length, code)
      if (next === index) return false
      focus(next)
      return true
    },
  }
}
