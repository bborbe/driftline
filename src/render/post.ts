// The post pipeline's pass order, one list view.ts builds the RenderPipeline from:
//   scene → [ao] → bloom → grade → [aa]
// The scene pass draws the HDR frame with the renderer's 4× MSAA (a pass inherits `renderer.samples`);
// ao (GTAO, `?ao=1`) is a normal/depth pre-pass whose occlusion darkens the scene's ambient light;
// bloom adds the glow (glow.ts); grade sets tint, saturation and contrast in linear light, then tone
// maps (grade.ts); aa is FXAA, which needs that display colour and so runs last. FXAA only smooths
// what MSAA misses (shader and texture edges) and costs ~10% fps at the flatout pose, so it is opt-in:
// Settings → Graphics → Anti-aliasing, `?aa=1`. With bloom off (`?bloom=0`) there is no pipeline at
// all, and the plain render keeps the same MSAA. Pure: nothing here touches the renderer.

export type PostPass = 'scene' | 'ao' | 'bloom' | 'grade' | 'aa'

export type PostOptions = { bloom: boolean; ao: boolean; aa: boolean }

export const postPasses = (o: PostOptions): PostPass[] => {
  if (!o.bloom) return ['scene']
  const out: PostPass[] = ['scene']
  if (o.ao) out.push('ao')
  out.push('bloom', 'grade')
  if (o.aa) out.push('aa')
  return out
}

/** GTAO is opt-in (`?ao=1`): its normal/depth pre-pass draws the scene a second time. */
export const aoRequested = (search: string): boolean => ['1', 'on', 'true'].includes(new URLSearchParams(search).get('ao') ?? '')
