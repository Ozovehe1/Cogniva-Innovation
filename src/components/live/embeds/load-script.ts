/** Load a third-party script once (GeoGebra, Desmos). */
const loading = new Map<string, Promise<void>>()
export function loadScript(src: string): Promise<void> {
  let p = loading.get(src)
  if (!p) {
    p = new Promise<void>((res, rej) => {
      const s = document.createElement('script')
      s.src = src; s.async = true
      s.onload = () => res(); s.onerror = () => { loading.delete(src); rej(new Error(`could not load ${new URL(src).hostname}`)) }
      document.head.appendChild(s)
    })
    loading.set(src, p)
  }
  return p
}
