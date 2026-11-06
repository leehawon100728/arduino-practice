import { CompileError, type NumType, type Token } from './lexer'

// ─── AST ─────────────────────────────────────────────────────

export interface TypeSpec { base: string; isConst: boolean; isStatic: boolean; line: number }

export type Expr =
  | { k: 'num'; value: number; ntype: NumType; line: number }
  | { k: 'str'; value: string; line: number }
  | { k: 'char'; value: number; line: number }
  | { k: 'ident'; name: string; line: number }
  | { k: 'scoped'; ns: string; name: string; line: number }
  | { k: 'binary'; op: string; l: Expr; r: Expr; line: number }
  | { k: 'logical'; op: '&&' | '||'; l: Expr; r: Expr; line: number }
  | { k: 'unary'; op: string; e: Expr; line: number }
  | { k: 'update'; op: '++' | '--'; prefix: boolean; target: Expr; line: number }
  | { k: 'assign'; op: string; target: Expr; value: Expr; line: number }
  | { k: 'cond'; test: Expr; a: Expr; b: Expr; line: number }
  | { k: 'call'; callee: Expr; args: Expr[]; line: number }
  | { k: 'index'; obj: Expr; index: Expr; line: number }
  | { k: 'member'; obj: Expr; prop: string; line: number }
  | { k: 'cast'; type: string; e: Expr; args?: Expr[]; line: number }
  | { k: 'sizeof'; type?: string; e?: Expr; line: number }
  | { k: 'comma'; list: Expr[]; line: number }
  | { k: 'initlist'; items: Expr[]; line: number }

export interface Declarator {
  name: string
  line: number
  array: null | { size: Expr | null }
  init: Expr | null
  ctorArgs: Expr[] | null
}

export interface VarDecl { k: 'var'; type: TypeSpec; decls: Declarator[]; line: number }

export interface Param { type: TypeSpec; name: string; isRef: boolean; isArray: boolean; line: number }
export interface FuncDef { k: 'func'; ret: TypeSpec; name: string; params: Param[]; body: Block | null; line: number; endLine: number }

export type Stmt =
  | VarDecl
  | Block
  | { k: 'expr'; e: Expr; line: number }
  | { k: 'if'; cond: Expr; then: Stmt; else: Stmt | null; line: number }
  | { k: 'while'; cond: Expr; body: Stmt; line: number }
  | { k: 'do'; cond: Expr; body: Stmt; line: number }
  | { k: 'for'; init: Stmt | null; cond: Expr | null; update: Expr | null; body: Stmt; line: number }
  | { k: 'break'; line: number }
  | { k: 'continue'; line: number }
  | { k: 'return'; e: Expr | null; line: number }
  | { k: 'switch'; disc: Expr; cases: { test: Expr | null; body: Stmt[]; line: number }[]; line: number }
  | { k: 'empty'; line: number }

export interface Block { k: 'block'; body: Stmt[]; line: number; endLine: number }

export interface Program { items: (VarDecl | FuncDef)[] }

// ─── 타입 이름 ───────────────────────────────────────────────

const PRIM_WORDS = new Set([
  'void', 'int', 'long', 'short', 'float', 'double', 'bool', 'boolean', 'char', 'byte', 'word', 'unsigned', 'signed',
  'String', 'uint8_t', 'int8_t', 'uint16_t', 'int16_t', 'uint32_t', 'int32_t', 'size_t',
])
export const CLASS_TYPES = new Set(['DHT11', 'DHT'])
const QUALIFIERS = new Set(['const', 'static', 'volatile', 'unsigned', 'signed'])

export function normalizeType(words: string[]): string | null {
  const w = words.filter((x) => x !== 'signed' || words.length === 1)
  const s = w.join(' ')
  const map: Record<string, string> = {
    void: 'void', int: 'int', short: 'int', 'short int': 'int', int16_t: 'int', signed: 'int',
    'unsigned int': 'uint', unsigned: 'uint', word: 'uint', uint16_t: 'uint', 'unsigned short': 'uint',
    long: 'long', 'long int': 'long', int32_t: 'long', 'long long': 'long',
    'unsigned long': 'ulong', 'unsigned long int': 'ulong', uint32_t: 'ulong', size_t: 'ulong',
    char: 'char', int8_t: 'char', 'unsigned char': 'byte', byte: 'byte', uint8_t: 'byte',
    bool: 'bool', boolean: 'bool', float: 'float', double: 'float', 'long double': 'float',
    String: 'String', DHT11: 'DHT11', DHT: 'DHT',
  }
  return map[s] ?? null
}

const PREC: Record<string, number> = {
  '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '>': 7, '<=': 7, '>=': 7,
  '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10,
}

// ─── 파서 ────────────────────────────────────────────────────

export function parse(tokens: Token[]): Program {
  let p = 0
  const peek = (o = 0) => tokens[Math.min(p + o, tokens.length - 1)]
  const next = () => tokens[p++]
  const is = (v: string, o = 0) => { const t = peek(o); return (t.t === 'op' || t.t === 'id') && t.v === v }
  const accept = (v: string) => { if (is(v)) { p++; return true } return false }
  const prevLine = () => tokens[Math.max(0, p - 1)].line

  const expect = (v: string, what?: string): Token => {
    if (is(v)) return next()
    const t = peek()
    if (v === ';') throw new CompileError(prevLine(), '세미콜론(;)이 빠졌어요.', '문장 끝에는 ; 를 붙여요.')
    if (v === ')') throw new CompileError(t.line, `괄호 ')' 가 빠졌어요${what ? ` (${what})` : ''}.`)
    if (v === ']') throw new CompileError(t.line, "대괄호 ']' 가 빠졌어요.")
    if (v === '(') throw new CompileError(t.line, `${what ?? ''} 다음에 '(' 가 필요해요.`)
    if (v === '{') throw new CompileError(t.line, `${what ?? ''} 중괄호 '{' 가 필요해요.`)
    if (v === '}') throw new CompileError(t.line, "중괄호 '}' 가 부족해요.")
    throw new CompileError(t.line, `'${v}' 가 필요한데 ${desc(t)} 가 있어요.`)
  }

  const desc = (t: Token) => (t.t === 'eof' ? '코드 끝' : `'${t.v}'`)

  const isTypeStart = (o = 0): boolean => {
    const t = peek(o)
    if (t.t !== 'id') return false
    if (t.v === 'const' || t.v === 'static' || t.v === 'volatile') return true
    if (CLASS_TYPES.has(t.v)) return !is('::', o + 1) && !is('(', o + 1)
    if (PRIM_WORDS.has(t.v)) {
      // String(x) 는 생성(캐스트) 식, int(x) 도 캐스트
      if (is('(', o + 1)) return false
      return true
    }
    return false
  }

  const parseType = (): TypeSpec => {
    const line = peek().line
    let isConst = false
    let isStatic = false
    const words: string[] = []
    for (;;) {
      const t = peek()
      if (t.t !== 'id') break
      if (t.v === 'const') { isConst = true; p++; continue }
      if (t.v === 'static') { isStatic = true; p++; continue }
      if (t.v === 'volatile') { p++; continue }
      if (PRIM_WORDS.has(t.v) || CLASS_TYPES.has(t.v)) {
        // unsigned long / long int 같은 여러 단어
        if (words.length && !QUALIFIERS.has(words[words.length - 1]) && !['long', 'short'].includes(words[words.length - 1]) && t.v !== 'int' && t.v !== 'long') break
        words.push(t.v)
        p++
        if (CLASS_TYPES.has(t.v) || t.v === 'String') break
        continue
      }
      break
    }
    if (accept('const')) isConst = true
    const base = normalizeType(words)
    if (!base) throw new CompileError(line, `'${words.join(' ') || peek().v}' 는 알 수 없는 자료형이에요.`)
    return { base, isConst, isStatic, line }
  }

  const identName = (what: string): Token => {
    const t = peek()
    if (t.t !== 'id') throw new CompileError(t.line, `${what} 이름이 필요한데 ${desc(t)} 가 있어요.`)
    return next()
  }

  // ── 최상위 ──
  const program: Program = { items: [] }
  while (peek().t !== 'eof') {
    const t = peek()
    if (is('}')) throw new CompileError(t.line, "닫는 중괄호 '}' 가 너무 많아요. 짝이 맞는지 확인하세요.")
    if (is(';')) { p++; continue }
    if (!isTypeStart()) {
      if (t.t === 'id' && is('(', 1)) {
        throw new CompileError(t.line, `함수 바깥에서 ${t.v}(...) 를 실행할 수 없어요. setup() 이나 loop() 안에 넣어 주세요.`)
      }
      if (t.t === 'id' && peek(1).t === 'id' && is('(', 2)) {
        throw new CompileError(t.line, `'${t.v}' 는 알 수 없는 자료형이에요. 함수는 void ${peek(1).v}() 처럼 만들어요.`)
      }
      throw new CompileError(t.line, `여기에는 변수 선언이나 함수만 올 수 있어요 (${desc(t)}).`)
    }
    const type = parseType()
    const name = identName('변수나 함수')
    if (is('(') && !CLASS_TYPES.has(type.base) && looksLikeParams()) program.items.push(parseFunc(type, name))
    else program.items.push(parseVarRest(type, name))
  }
  return program

  /** '(' 뒤가 매개변수 목록이면 함수, 값이면 생성자 초기화 */
  function looksLikeParams() {
    if (is(')', 1)) return true
    const t = peek(1)
    return t.t === 'id' && (PRIM_WORDS.has(t.v) || CLASS_TYPES.has(t.v) || t.v === 'const')
  }

  function parseFunc(ret: TypeSpec, nameTok: Token): FuncDef {
    expect('(')
    const params: Param[] = []
    if (!is(')')) {
      if (is('void') && is(')', 1)) p++
      else {
        do {
          const type = parseType()
          const isRef = accept('&')
          const nt = identName('매개변수')
          let isArray = false
          if (accept('[')) { while (!is(']') && peek().t !== 'eof') p++; expect(']'); isArray = true }
          params.push({ type, name: nt.v, isRef, isArray, line: nt.line })
        } while (accept(','))
      }
    }
    expect(')', `${nameTok.v} 함수의 매개변수`)
    if (accept(';')) return { k: 'func', ret, name: nameTok.v, params, body: null, line: nameTok.line, endLine: nameTok.line }
    if (!is('{')) {
      if (peek().t === 'eof' || peek().line > nameTok.line) throw new CompileError(nameTok.line, `${nameTok.v}() 다음에 중괄호 '{' 가 필요해요.`)
    }
    const body = parseBlock(`${nameTok.v}() 함수`)
    return { k: 'func', ret, name: nameTok.v, params, body, line: nameTok.line, endLine: body.endLine }
  }

  function parseDeclarator(type: TypeSpec, nameTok: Token): Declarator {
    const d: Declarator = { name: nameTok.v, line: nameTok.line, array: null, init: null, ctorArgs: null }
    if (accept('[')) {
      d.array = { size: is(']') ? null : parseExpr() }
      expect(']')
    }
    if (accept('=')) {
      d.init = is('{') ? parseInitList() : parseAssign()
    } else if (is('(') && (CLASS_TYPES.has(type.base) || type.base !== 'void')) {
      p++
      const args: Expr[] = []
      if (!is(')')) do args.push(parseAssign()); while (accept(','))
      expect(')')
      d.ctorArgs = args
    }
    return d
  }

  function parseVarRest(type: TypeSpec, firstName: Token): VarDecl {
    const decls = [parseDeclarator(type, firstName)]
    while (accept(',')) decls.push(parseDeclarator(type, identName('변수')))
    expect(';')
    return { k: 'var', type, decls, line: firstName.line }
  }

  function parseInitList(): Expr {
    const line = expect('{').line
    const items: Expr[] = []
    if (!is('}')) {
      do { if (is('}')) break; items.push(is('{') ? parseInitList() : parseAssign()) } while (accept(','))
    }
    expect('}')
    return { k: 'initlist', items, line }
  }

  function parseBlock(owner?: string): Block {
    const open = peek()
    if (!is('{')) throw new CompileError(open.line, `${owner ?? ''} 중괄호 '{' 가 필요해요.`)
    p++
    const body: Stmt[] = []
    while (!is('}')) {
      if (peek().t === 'eof') {
        throw new CompileError(open.line, `${open.line}번째 줄에서 연 중괄호 '{' 가 닫히지 않았어요. '}' 를 추가하세요.`)
      }
      body.push(parseStmt())
    }
    const end = next()
    return { k: 'block', body, line: open.line, endLine: end.line }
  }

  function parseStmt(): Stmt {
    const t = peek()
    const line = t.line
    if (is('{')) return parseBlock()
    if (is(';')) { p++; return { k: 'empty', line } }
    if (t.t === 'id') {
      switch (t.v) {
        case 'if': {
          p++
          expect('(', 'if')
          const cond = parseExpr()
          expect(')', 'if 조건')
          if (is(';')) throw new CompileError(line, 'if (...) 바로 뒤에 세미콜론(;)이 있어요. 그러면 조건과 상관없이 아래 코드가 실행돼요.')
          const then = parseStmt()
          let els: Stmt | null = null
          if (accept('else')) els = parseStmt()
          return { k: 'if', cond, then, else: els, line }
        }
        case 'else':
          throw new CompileError(line, 'else 앞에 짝이 되는 if 가 없어요. if 블록의 중괄호나 세미콜론을 확인하세요.')
        case 'while': {
          p++
          expect('(', 'while')
          const cond = parseExpr()
          expect(')', 'while 조건')
          const body = parseStmt()
          return { k: 'while', cond, body, line }
        }
        case 'do': {
          p++
          const body = parseStmt()
          if (!accept('while')) throw new CompileError(peek().line, 'do { ... } 다음에 while (조건); 이 필요해요.')
          expect('(', 'while')
          const cond = parseExpr()
          expect(')')
          expect(';')
          return { k: 'do', cond, body, line }
        }
        case 'for': {
          p++
          expect('(', 'for')
          let init: Stmt | null = null
          if (!accept(';')) {
            if (isTypeStart()) {
              const type = parseType()
              init = parseVarRest(type, identName('변수'))
            } else {
              init = { k: 'expr', e: parseExpr(), line }
              if (is(',')) throw new CompileError(line, 'for 문의 세 부분은 쉼표(,)가 아니라 세미콜론(;)으로 나눠요.')
              expect(';')
            }
          }
          const cond = is(';') ? null : parseExpr()
          if (is(',')) throw new CompileError(line, 'for 문의 세 부분은 쉼표(,)가 아니라 세미콜론(;)으로 나눠요.')
          expect(';')
          const update = is(')') ? null : parseExpr()
          expect(')', 'for')
          const body = parseStmt()
          return { k: 'for', init, cond, update, body, line }
        }
        case 'break': p++; expect(';'); return { k: 'break', line }
        case 'continue': p++; expect(';'); return { k: 'continue', line }
        case 'return': {
          p++
          const e = is(';') ? null : parseExpr()
          expect(';')
          return { k: 'return', e, line }
        }
        case 'switch': {
          p++
          expect('(', 'switch')
          const disc = parseExpr()
          expect(')')
          expect('{')
          const cases: { test: Expr | null; body: Stmt[]; line: number }[] = []
          while (!is('}')) {
            const ct = peek()
            if (ct.t === 'eof') throw new CompileError(line, "switch 의 중괄호 '}' 가 닫히지 않았어요.")
            if (accept('case')) {
              const test = parseCond()
              expect(':')
              cases.push({ test, body: [], line: ct.line })
            } else if (accept('default')) {
              expect(':')
              cases.push({ test: null, body: [], line: ct.line })
            } else {
              if (!cases.length) throw new CompileError(ct.line, 'switch 안에서는 case 값: 으로 시작해야 해요.')
              cases[cases.length - 1].body.push(parseStmt())
            }
          }
          p++
          return { k: 'switch', disc, cases, line }
        }
      }
      if (isTypeStart()) {
        const type = parseType()
        const nameTok = identName('변수')
        if (is('(') && is(')', 1) && is('{', 2)) {
          throw new CompileError(nameTok.line, `함수 안에서 다른 함수 ${nameTok.v}() 를 만들 수 없어요. 위쪽 함수의 중괄호 '{' 가 닫히지 않았어요. '}' 를 확인하세요.`)
        }
        return parseVarRest(type, nameTok)
      }
      // "Int x = 3;" 처럼 대소문자 실수
      if (peek(1).t === 'id' && (is('=', 2) || is(';', 2))) {
        throw new CompileError(line, `'${t.v}' 는 알 수 없는 자료형이에요.${/^(Int|Float|Bool|Long|Void|Char)$/.test(t.v) ? ` 소문자 ${t.v.toLowerCase()} 로 써야 해요.` : ''}`)
      }
    }
    const e = parseExpr()
    if (!is(';')) {
      const nt = peek()
      if (nt.line > prevLine() || nt.t === 'eof' || is('}')) throw new CompileError(prevLine(), '세미콜론(;)이 빠졌어요.', '문장 끝에는 ; 를 붙여요.')
      throw new CompileError(nt.line, `${desc(nt)} 앞에 세미콜론(;)이나 연산자가 빠진 것 같아요.`)
    }
    p++
    return { k: 'expr', e, line }
  }

  // ── 식 ──
  function parseExpr(): Expr {
    const first = parseAssign()
    if (!is(',')) return first
    const list = [first]
    while (accept(',')) list.push(parseAssign())
    return { k: 'comma', list, line: first.line }
  }

  function parseAssign(): Expr {
    const l = parseCond()
    const t = peek()
    if (t.t === 'op' && ['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>='].includes(t.v)) {
      p++
      const value = parseAssign()
      return { k: 'assign', op: t.v, target: l, value, line: t.line }
    }
    return l
  }

  function parseCond(): Expr {
    const test = parseBin(0)
    if (!is('?')) return test
    const line = next().line
    const a = parseAssign()
    expect(':')
    const b = parseAssign()
    return { k: 'cond', test, a, b, line }
  }

  function parseBin(minPrec: number): Expr {
    let l = parseUnary()
    for (;;) {
      const t = peek()
      const prec = t.t === 'op' ? PREC[t.v] : undefined
      if (prec === undefined || prec <= minPrec) break
      p++
      // "=<" 같은 실수
      if (t.v === '<' && is('=') ) throw new CompileError(t.line, "'<=' 를 '< =' 처럼 띄어 썼어요. 붙여서 써 주세요.")
      const r = parseBin(prec)
      l = t.v === '&&' || t.v === '||' ? { k: 'logical', op: t.v, l, r, line: t.line } : { k: 'binary', op: t.v, l, r, line: t.line }
    }
    return l
  }

  function parseUnary(): Expr {
    const t = peek()
    if (t.t === 'op') {
      if (t.v === '++' || t.v === '--') { p++; return { k: 'update', op: t.v, prefix: true, target: parseUnary(), line: t.line } }
      if (['-', '+', '!', '~'].includes(t.v)) { p++; return { k: 'unary', op: t.v, e: parseUnary(), line: t.line } }
      if (t.v === '&' || t.v === '*') throw new CompileError(t.line, '포인터(&, *)는 이 시뮬레이터에서 지원하지 않아요.')
      // (type) 캐스트
      if (t.v === '(' && peek(1).t === 'id' && (PRIM_WORDS.has(peek(1).v)) ) {
        let q = 1
        const words: string[] = []
        while (peek(q).t === 'id' && (PRIM_WORDS.has(peek(q).v) || peek(q).v === 'const')) { if (peek(q).v !== 'const') words.push(peek(q).v); q++ }
        if (is(')', q)) {
          const ty = normalizeType(words)
          if (ty) {
            p += q + 1
            return { k: 'cast', type: ty, e: parseUnary(), line: t.line }
          }
        }
      }
    }
    if (t.t === 'id' && t.v === 'sizeof') {
      p++
      expect('(', 'sizeof')
      let r: Expr
      if (peek().t === 'id' && PRIM_WORDS.has(peek().v)) {
        const ty = parseType()
        r = { k: 'sizeof', type: ty.base, line: t.line }
      } else r = { k: 'sizeof', e: parseExpr(), line: t.line }
      expect(')')
      return r
    }
    return parsePostfix(parsePrimary())
  }

  function parsePostfix(e: Expr): Expr {
    for (;;) {
      const t = peek()
      if (is('(')) {
        p++
        const args: Expr[] = []
        if (!is(')')) do args.push(parseAssign()); while (accept(','))
        if (!is(')')) {
          if (is(';') || peek().line > t.line) throw new CompileError(t.line, "함수 호출의 괄호 ')' 가 닫히지 않았어요.")
          throw new CompileError(peek().line, `함수 인자 사이에는 쉼표(,)가 필요해요 (${desc(peek())} 앞).`)
        }
        p++
        e = { k: 'call', callee: e, args, line: t.line }
      } else if (is('[')) {
        p++
        const index = parseExpr()
        expect(']')
        e = { k: 'index', obj: e, index, line: t.line }
      } else if (is('.') || is('->')) {
        p++
        const nt = identName('멤버')
        e = { k: 'member', obj: e, prop: nt.v, line: nt.line }
      } else if (is('++') || is('--')) {
        p++
        e = { k: 'update', op: t.v as '++' | '--', prefix: false, target: e, line: t.line }
      } else break
    }
    return e
  }

  function parsePrimary(): Expr {
    const t = peek()
    if (t.t === 'num') { p++; return { k: 'num', value: t.num!, ntype: t.numType!, line: t.line } }
    if (t.t === 'str') { p++; return { k: 'str', value: t.v, line: t.line } }
    if (t.t === 'char') { p++; return { k: 'char', value: t.num!, line: t.line } }
    if (t.t === 'id') {
      p++
      if (t.v === 'true' || t.v === 'false') return { k: 'num', value: t.v === 'true' ? 1 : 0, ntype: 'int', line: t.line }
      if (is('::')) {
        p++
        const nt = identName('멤버')
        return { k: 'scoped', ns: t.v, name: nt.v, line: t.line }
      }
      // 함수형 캐스트: int(x), float(x), String(x, n)
      if (PRIM_WORDS.has(t.v) && is('(')) {
        const ty = normalizeType([t.v])
        if (ty && ty !== 'void') {
          p++
          const args: Expr[] = []
          if (!is(')')) do args.push(parseAssign()); while (accept(','))
          expect(')')
          return { k: 'cast', type: ty, e: args[0] ?? { k: 'str', value: '', line: t.line }, args, line: t.line }
        }
      }
      return { k: 'ident', name: t.v, line: t.line }
    }
    if (is('(')) {
      p++
      const e = parseExpr()
      expect(')', '식')
      return e
    }
    if (t.t === 'eof') throw new CompileError(prevLine(), '코드가 중간에 끝났어요. 괄호나 중괄호가 닫혔는지 확인하세요.')
    if (is(';')) throw new CompileError(t.line, "';' 앞에 값이 빠졌어요.")
    if (is(')')) throw new CompileError(t.line, "')' 앞에 값이 빠졌어요.")
    throw new CompileError(t.line, `${desc(t)} 는 여기에 올 수 없어요.`)
  }
}
