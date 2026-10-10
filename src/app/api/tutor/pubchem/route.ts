/**
 * GET /api/tutor/pubchem?cid=962 → the compound's SDF (3D record, else 2D) from PubChem. PubChem's REST API sends no
 * CORS headers, so the 3D molecule viewer reads structures through here. Public data; cached a day.
 */
export async function GET(request: Request) {
  const cid = Number(new URL(request.url).searchParams.get('cid'))
  if (!Number.isInteger(cid) || cid <= 0 || cid > 1e9) return new Response('bad cid', { status: 400 })
  for (const rt of ['3d', '2d']) {
    const r = await fetch(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/SDF?record_type=${rt}`, { signal: AbortSignal.timeout(8000) }).catch(() => null)
    if (r?.ok) {
      const t = await r.text()
      if (t.length < 400_000) return new Response(t, { headers: { 'Content-Type': 'chemical/x-mdl-sdfile', 'X-Record-Type': rt, 'Cache-Control': 'public, max-age=86400' } })
    }
  }
  return new Response('not found', { status: 404 })
}
