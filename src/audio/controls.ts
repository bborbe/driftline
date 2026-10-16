// Begin overlay, volume slider and M-to-mute. The Begin click is the user gesture that unlocks audio.
import type { GameAudio } from './game-audio'

export const mountAudioControls = (audio: GameAudio): void => {
  const overlay = document.createElement('button')
  overlay.id = 'begin'
  overlay.textContent = 'Begin'
  overlay.style.cssText = 'position:fixed;inset:0;margin:auto;width:200px;height:64px;font-size:28px;cursor:pointer;z-index:10'
  overlay.addEventListener('click', () => {
    void audio.begin().then(() => console.log(`audio: ${audio.state}`))
    overlay.remove()
  }, { once: true })
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
  document.body.appendChild(slider)

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyM' && !e.repeat) audio.toggleMute()
  })
}
