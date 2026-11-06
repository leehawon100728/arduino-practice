// 아두이노(AVR) 자료형 규칙: int 는 16비트, long 은 32비트, double 은 float 과 같다.

export type Ty = 'int' | 'uint' | 'long' | 'ulong' | 'char' | 'byte' | 'bool' | 'float' | 'void' | 'String' | 'cstr' | 'DHT11' | 'DHT'

export const INT_TYPES: Ty[] = ['int', 'uint', 'long', 'ulong', 'char', 'byte', 'bool']
export const isInt = (t: Ty) => INT_TYPES.includes(t)
export const isNum = (t: Ty) => isInt(t) || t === 'float'
export const isText = (t: Ty) => t === 'String' || t === 'cstr'

export const TYPE_KO: Record<Ty, string> = {
  int: 'int', uint: 'unsigned int', long: 'long', ulong: 'unsigned long', char: 'char', byte: 'byte', bool: 'bool',
  float: 'float', void: 'void', String: 'String', cstr: '문자열', DHT11: 'DHT11', DHT: 'DHT',
}

export const SIZEOF: Partial<Record<Ty, number>> = { int: 2, uint: 2, long: 4, ulong: 4, char: 1, byte: 1, bool: 1, float: 4 }

function promote(t: Ty): Ty {
  if (t === 'char' || t === 'byte' || t === 'bool' || t === 'int') return 'int'
  return t
}

/** 산술 연산 결과 자료형 (C 의 usual arithmetic conversions 단순화) */
export function arithType(a: Ty, b: Ty): Ty {
  if (a === 'float' || b === 'float') return 'float'
  const pa = promote(a)
  const pb = promote(b)
  if (pa === 'ulong' || pb === 'ulong') return 'ulong'
  if (pa === 'long' || pb === 'long') return 'long'
  if (pa === 'uint' || pb === 'uint') return 'uint'
  return 'int'
}

export function unaryType(a: Ty): Ty {
  return a === 'float' ? 'float' : promote(a)
}

/** 값을 자료형에 맞게 변환 (정수 오버플로, 소수점 버림 포함) */
export function conv(v: number, t: Ty): number {
  switch (t) {
    case 'int': return (Math.trunc(v) << 16) >> 16
    case 'uint': return Math.trunc(v) & 0xffff
    case 'long': return Math.trunc(v) | 0
    case 'ulong': return Math.trunc(v) >>> 0
    case 'char': return (Math.trunc(v) << 24) >> 24
    case 'byte': return Math.trunc(v) & 0xff
    case 'bool': return v ? 1 : 0
    case 'float': return Math.fround(v)
    default: return v
  }
}

export function convAny(v: unknown, t: Ty): unknown {
  if (t === 'String' || t === 'cstr') return typeof v === 'string' ? v : String(v)
  if (typeof v === 'number') return conv(v, t)
  return v
}

/** Arduino 의 print 형식으로 숫자를 문자열로 */
export function formatValue(v: unknown, t: Ty, fmt?: number): string {
  if (typeof v === 'string') return v
  if (typeof v !== 'number') return String(v)
  if (t === 'float') {
    if (Number.isNaN(v)) return 'nan'
    if (!Number.isFinite(v)) return 'inf'
    const digits = fmt ?? 2
    return v.toFixed(Math.max(0, Math.min(digits, 10)))
  }
  if (t === 'char' && fmt === undefined) return String.fromCharCode(v & 0xff)
  if (fmt === 16 || fmt === 2 || fmt === 8) {
    const width = t === 'long' || t === 'ulong' ? 32 : t === 'char' || t === 'byte' ? 8 : 32
    const u = width === 32 ? v >>> 0 : v & ((1 << width) - 1)
    return u.toString(fmt).toUpperCase()
  }
  return String(v)
}
