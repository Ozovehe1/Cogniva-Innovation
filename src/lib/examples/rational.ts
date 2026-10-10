/**
 * Exact rational arithmetic on BigInt, so circuit answers are exact (1/3 A stays 1/3 A) and "is this a nice number"
 * is decidable. Pure, no dependencies: runs in the browser (live re-solve when a learner drags a value) and on Vercel.
 */
const B0 = BigInt(0), B1 = BigInt(1), B2 = BigInt(2), B5 = BigInt(5), B10 = BigInt(10), B12 = BigInt(12)
const gcd = (a: bigint, b: bigint): bigint => { a = a < B0 ? -a : a; b = b < B0 ? -b : b; while (b) [a, b] = [b, a % b]; return a }

export class Q {
  readonly n: bigint
  readonly d: bigint
  constructor(n: bigint, d: bigint = B1) {
    if (d === B0) throw new Error('division by zero')
    if (d < B0) { n = -n; d = -d }
    const g = gcd(n, d) || B1
    this.n = n / g; this.d = d / g
  }
  static zero = new Q(B0)
  static one = new Q(B1)
  /** A plain decimal string or number (no exponent): "12", "0.5", 4.7. */
  static of(v: Q | string | number): Q {
    if (v instanceof Q) return v
    let s = String(v).trim()
    if (typeof v === 'number') { if (!Number.isFinite(v)) throw new Error('not a finite number'); s = v.toFixed(12).replace(/\.?0+$/, '') }
    if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`not a plain number: ${s}`)
    const neg = s.startsWith('-'); if (neg) s = s.slice(1)
    const [i, f = ''] = s.split('.')
    const q = new Q(BigInt(i + f), B10 ** BigInt(f.length))
    return neg ? q.neg() : q
  }
  static isPlain(v: unknown) { return typeof v === 'string' ? /^-?\d+(\.\d+)?$/.test(v.trim()) : typeof v === 'number' && Number.isFinite(v) }
  add(o: Q | string | number) { const b = Q.of(o); return new Q(this.n * b.d + b.n * this.d, this.d * b.d) }
  sub(o: Q | string | number) { const b = Q.of(o); return new Q(this.n * b.d - b.n * this.d, this.d * b.d) }
  mul(o: Q | string | number) { const b = Q.of(o); return new Q(this.n * b.n, this.d * b.d) }
  div(o: Q | string | number) { const b = Q.of(o); return new Q(this.n * b.d, this.d * b.n) }
  neg() { return new Q(-this.n, this.d) }
  abs() { return this.n < B0 ? this.neg() : this }
  inv() { return new Q(this.d, this.n) }
  isZero() { return this.n === B0 }
  sign() { return this.n === B0 ? 0 : this.n > B0 ? 1 : -1 }
  eq(o: Q | string | number) { return this.sub(o).isZero() }
  cmp(o: Q | string | number) { return this.sub(o).sign() }
  num() { return Number(this.n) / Number(this.d) }
  /** Decimals needed to write it exactly, or Infinity (e.g. 1/3). */
  decimals() { let d = this.d, k2 = 0, k5 = 0; while (d % B2 === B0) { d /= B2; k2++ } while (d % B5 === B0) { d /= B5; k5++ } return d === B1 ? Math.max(k2, k5) : Infinity }
  /** Exact decimal when short, else a fraction "1/3". */
  toString() { const k = this.decimals(); if (k === 0) return String(this.n); if (k <= 6) return trimZeros(this.num().toFixed(k)); return `${this.n}/${this.d}` }
  /** For people: exact when it fits in p decimals, else p+1 significant figures. */
  approx(p = 2) { const k = this.decimals(); if (k <= p) return this.toString(); const x = this.num(); return trimZeros(Math.abs(x) >= 1 ? x.toFixed(p) : x.toPrecision(p + 1)) }
  /** LaTeX: exact decimal, a \tfrac for simple fractions, else ≈ decimal. */
  tex(p = 2) { const k = this.decimals(); if (k <= Math.max(p, 3)) return this.toString(); if (this.d <= B12) return `${this.n < B0 ? '-' : ''}\\tfrac{${this.n < B0 ? -this.n : this.n}}{${this.d}}`; return `\\approx ${this.approx(p)}` }
}

const trimZeros = (s: string) => s.includes('.') ? s.replace(/\.?0+$/, '') : s

/** Every number written in a piece of text (for checking that narration only uses the solver's numbers). */
export function numbersIn(text: string): string[] {
  return (text.replace(/(\d),(\d{3})\b/g, '$1$2').match(/-?\d+(?:\.\d+)?/g) ?? []).map(s => s.replace(/^-/, ''))
}

/** Same value, tolerant of how a person writes it ("1.50" = "1.5", "0.5" = ".5"). */
export function sameNumber(a: string, b: string) {
  const x = Number(a), y = Number(b)
  return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x))
}
