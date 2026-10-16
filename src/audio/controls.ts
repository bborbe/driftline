// Begin overlay, volume slider and M-to-mute. The Begin click is the user gesture that unlocks audio
// and, through `onBegin`, starts the race countdown — the game's single start signal.
import type { GameAudio } from './game-audio'

type KeyTarget = { tagName?: string; type?: string } | null

// Enter / Space press Begin — except while typing (the top-10 name entry submits on Enter).
export const isBeginKey = (code: string, repeat: boolean, target: KeyTarget): boolean => {
  if (repeat || (code !== 'Enter' && code !== 'NumpadEnter' && code !== 'Space')) return false
  const tag = target?.tagName?.toUpperCase()
  if (tag === 'TEXTAREA') return false
  return !(tag === 'INPUT' && target?.type !== 'range')
}

export const mountAudioControls = (audio: GameAudio, onBegin: () => void = () => {}): void => {
  const overlay = document.createElement('button')
  overlay.id = 'begin'
  overlay.innerHTML = 'Begin<br><small style="font-size:12px">Enter / Space to start</small>'
  overlay.style.cssText = 'position:fixed;inset:0;margin:auto;width:200px;height:72px;font-size:28px;cursor:pointer;z-index:10'
  // One-shot: the overlay leaves the DOM on Begin, so a running countdown or race can never re-trigger it.
  let begun = false
  const begin = () => {
    if (begun) return
    begun = true
    window.removeEventListener('keydown', onKey)
    void audio.begin().then(() => console.log(`audio: ${audio.state}`))
    overlay.remove()
    onBegin()
  }
  const onKey = (e: KeyboardEvent) => {
    if (!overlay.isConnected || !isBeginKey(e.code, e.repeat, e.target as KeyTarget)) return
    e.preventDefault()
    begin()
  }
  overlay.addEventListener('click', begin)
  window.addEventListener('keydown', onKey)
  document.body.appendChild(overlay)

  const slider = document.createElement('input')
  slider.id = 'volume'
  slider.type = 'range'
  slider.min = '0'
  slider.max = '1'
  slider.step = '0.05'
  slider.value = '0.7'
  slider.title = 'Volume (M to mute)'
  slider.style.cssText = 'position:fixed;right:12px;top:12px;z-index:10'
  slider.addEventListener('input', () => audio.setVolume(Number(slider.value)))
  // Drop focus after use so arrow keys keep steering instead of nudging the volume.
  slider.addEventListener('pointerup', () => slider.blur())
  document.body.appendChild(slider)

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyM' && !e.repeat) audio.toggleMute()
  })
}
