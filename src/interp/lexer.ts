// ─────────────────────────────────────────────────────────────
// 토크나이저 + 간단한 전처리기 (#include, #define)
// ─────────────────────────────────────────────────────────────

export type TokType = 'id' | 'num' | 'str' | 'char' | 'op' | 'eof'
export type NumType = 'int' | 'uint' | 'long' | 'ulong' | 'float'

export interface Token {
  t: TokType
  v: string
  line: number
  col: number
  num?: number
  numType?: NumType
}

export class CompileError extends Error {
  constructor(public line: number, message: string, public hint?: string) {
    super(message)
  }
}

const OPS = [
  '<<=', '>>=', '::', '++', '--', '==', '!=', '<=', '>=', '&&', '||', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>', '->',
  '+', '-', '*', '/', '%', '=', '<', '>', '!', '&', '|', '^', '~', '?', ':', ';', ',', '.', '(', ')', '[', ']', '{', '}',
]

export interface PreprocessResult {
  tokens: Token[]
  includes: { name: string; line: number }[]
  defines: Map<string, Token[]>
  warnings: { line: number; message: string }[]
}

export const KNOWN_LIBS = ['DHT11.h', 'DHT.h', 'Arduino.h']

export function preprocess(src: string): PreprocessResult {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const includes: PreprocessResult['includes'] = []
  const defines = new Map<string, Token[]>()
  const warnings: PreprocessResult['warnings'] = []
  const body: string[] = []

  // 여러 줄 주석 안의 # 은 무시해야 하므로 간단히 주석 상태를 추적
  let inBlock = false
  lines.forEach((raw, i) => {
    const lineNo = i + 1
    let text = raw
    const trimmed = text.trimStart()
    if (!inBlock && trimmed.startsWith('#')) {
      const m = trimmed.match(/^#\s*(\w+)\s*(.*)$/)
      const dir = m?.[1] ?? ''
      const rest = (m?.[2] ?? '').replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '').trim()
      if (dir === 'include') {
        const im = rest.match(/^[<"]([^>"]+)[>"]$/)
        if (!im) throw new CompileError(lineNo, '#include 형식이 올바르지 않아요. 예: #include <DHT11.h>')
        includes.push({ name: im[1], line: lineNo })
        if (!KNOWN_LIBS.includes(im[1])) warnings.push({ line: lineNo, message: `${im[1]} 라이브러리는 이 시뮬레이터에서 지원하지 않아요.` })
      } else if (dir === 'define') {
        const dm = rest.match(/^([A-Za-z_]\w*)(\()?/)
        if (!dm) throw new CompileError(lineNo, '#define 다음에 이름이 필요해요. 예: #define LED_PIN 11')
        if (dm[2]) throw new CompileError(lineNo, '괄호가 있는 #define 매크로(함수형 매크로)는 지원하지 않아요. 함수를 만들어 주세요.')
        const valueSrc = rest.slice(dm[1].length)
        defines.set(dm[1], tokenize(valueSrc, lineNo).slice(0, -1))
      } else if (dir === 'pragma') {
        // 무시
      } else {
        throw new CompileError(lineNo, `#${dir} 는 지원하지 않는 전처리 명령이에요.`)
      }
      body.push('')
      return
    }
    // 블록 주석 상태 갱신 (문자열 안의 /* 는 드물어서 무시)
    let j = 0
    while (j < text.length) {
      if (inBlock) {
        const e = text.indexOf('*/', j)
        if (e < 0) { j = text.length; break }
        inBlock = false
        j = e + 2
      } else {
        const s = text.indexOf('/*', j)
        const lc = text.indexOf('//', j)
        if (s < 0 || (lc >= 0 && lc < s)) break
        inBlock = true
        j = s + 2
      }
    }
    body.push(text)
    text = ''
  })

  let tokens = tokenize(body.join('\n'), 1)
  // #define 치환
  if (defines.size) {
    const expand = (toks: Token[], depth: number): Token[] => {
      const out: Token[] = []
      for (const tk of toks) {
        const d = tk.t === 'id' ? defines.get(tk.v) : undefined
        if (d && depth < 10) out.push(...expand(d.map((x) => ({ ...x, line: tk.line, col: tk.col })), depth + 1))
        else out.push(tk)
      }
      return out
    }
    const eof = tokens[tokens.length - 1]
    tokens = [...expand(tokens.slice(0, -1), 0), eof]
  }
  return { tokens, includes, defines, warnings }
}

export function tokenize(src: string, startLine: number): Token[] {
  const out: Token[] = []
  let i = 0
  let line = startLine
  let col = 1
  const n = src.length
  const adv = (k = 1) => {
    for (let q = 0; q < k; q++) {
      if (src[i] === '\n') { line++; col = 1 } else col++
      i++
    }
  }
  while (i < n) {
    const c = src[i]
    if (c === '\n' || c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v' || c === ' ') { adv(); continue }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') adv(); continue }
    if (c === '/' && src[i + 1] === '*') {
      const sl = line
      adv(2)
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) adv()
      if (i >= n) throw new CompileError(sl, '/* 주석이 닫히지 않았어요. */ 로 닫아 주세요.')
      adv(2)
      continue
    }
    const sl = line
    const sc = col
    if (/[A-Za-z_]/.test(c)) {
      let j = i
      while (j < n && /\w/.test(src[j])) j++
      out.push({ t: 'id', v: src.slice(i, j), line: sl, col: sc })
      adv(j - i)
      continue
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i
      let value: number
      let isFloat = false
      if (c === '0' && /[xX]/.test(src[i + 1] ?? '')) {
        j += 2
        while (j < n && /[0-9a-fA-F]/.test(src[j])) j++
        value = parseInt(src.slice(i + 2, j), 16)
      } else if (c === '0' && /[bB]/.test(src[i + 1] ?? '')) {
        j += 2
        while (j < n && /[01]/.test(src[j])) j++
        value = parseInt(src.slice(i + 2, j), 2)
      } else {
        while (j < n && /[0-9]/.test(src[j])) j++
        if (src[j] === '.') { isFloat = true; j++; while (j < n && /[0-9]/.test(src[j])) j++ }
        if (/[eE]/.test(src[j] ?? '') && /[-+0-9]/.test(src[j + 1] ?? '')) {
          isFloat = true
          j++
          if (/[-+]/.test(src[j])) j++
          while (j < n && /[0-9]/.test(src[j])) j++
        }
        value = Number(src.slice(i, j))
      }
      let suf = ''
      while (j < n && /[uUlLfF]/.test(src[j])) { suf += src[j].toLowerCase(); j++ }
      if (j < n && /[A-Za-z_]/.test(src[j])) throw new CompileError(sl, `숫자 '${src.slice(i, j + 1)}' 형식이 이상해요.`)
      let numType: NumType
      if (isFloat || suf.includes('f')) numType = 'float'
      else if (suf.includes('u') && suf.includes('l')) numType = 'ulong'
      else if (suf.includes('l')) numType = value > 2147483647 ? 'ulong' : 'long'
      else if (suf.includes('u')) numType = value > 65535 ? 'ulong' : 'uint'
      else numType = value > 32767 ? (value > 2147483647 ? 'ulong' : 'long') : 'int'
      out.push({ t: 'num', v: src.slice(i, j), line: sl, col: sc, num: value, numType })
      adv(j - i)
      continue
    }
    if (c === '"') {
      adv()
      let s = ''
      while (i < n && src[i] !== '"') {
        if (src[i] === '\n') throw new CompileError(sl, '문자열의 따옴표(")가 닫히지 않았어요.')
        if (src[i] === '\\') { s += escape(src[i + 1]); adv(2) } else { s += src[i]; adv() }
      }
      if (i >= n) throw new CompileError(sl, '문자열의 따옴표(")가 닫히지 않았어요.')
      adv()
      // "abc" "def" 이어 붙이기
      const prev = out[out.length - 1]
      if (prev && prev.t === 'str') { prev.v += s; continue }
      out.push({ t: 'str', v: s, line: sl, col: sc })
      continue
    }
    if (c === "'") {
      adv()
      let ch: string
      if (src[i] === '\\') { ch = escape(src[i + 1]); adv(2) } else { ch = src[i]; adv() }
      if (src[i] !== "'") throw new CompileError(sl, "글자 하나는 작은따옴표로 감싸요. 예: 'A'. 여러 글자는 큰따옴표(\")를 쓰세요.")
      adv()
      out.push({ t: 'char', v: ch, line: sl, col: sc, num: ch.charCodeAt(0) })
      continue
    }
    const op = OPS.find((o) => src.startsWith(o, i))
    if (op) {
      out.push({ t: 'op', v: op, line: sl, col: sc })
      adv(op.length)
      continue
    }
    if (c === '；') throw new CompileError(sl, "전각 세미콜론(；)이 들어갔어요. 영문 세미콜론(;)으로 바꿔 주세요.")
    if (c === '“' || c === '”') throw new CompileError(sl, '둥근 따옴표(“ ”)가 들어갔어요. 키보드의 곧은 따옴표(")로 바꿔 주세요.')
    if (/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(c)) throw new CompileError(sl, `코드에 한글 '${c}' 이(가) 들어갔어요. 한글은 주석(//)이나 문자열("") 안에서만 쓸 수 있어요.`)
    throw new CompileError(sl, `이해할 수 없는 문자 '${c}' 가 있어요.`)
  }
  out.push({ t: 'eof', v: '', line, col })
  return out
}

function escape(c: string) {
  switch (c) {
    case 'n': return '\n'
    case 't': return '\t'
    case 'r': return '\r'
    case '0': return '\0'
    case '\\': return '\\'
    case '"': return '"'
    case "'": return "'"
    default: return c ?? ''
  }
}
