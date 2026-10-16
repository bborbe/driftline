// Which URLs bypass the start screen. Pure and tested.
const DIRECT = ['track', 'x', 'y', 'z', 'yaw', 'freeze', 'cam']

/** True when the query names a track or a debug spawn / camera, so the game starts without the menu. */
export const skipMenu = (search: string): boolean => {
  const q = new URLSearchParams(search)
  return DIRECT.some((k) => q.has(k))
}
