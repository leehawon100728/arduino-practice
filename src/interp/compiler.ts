import type { Hardware } from '../sim/board'
import { CompileError, preprocess } from './lexer'
import { parse, type Block, type Declarator, type Expr, type FuncDef, type Program, type Stmt, type VarDecl } from './parser'
import { arithType, conv, convAny, formatValue, isInt, isNum, isText, SIZEOF, TYPE_KO, unaryType, type Ty } from './types'
import { josa } from '../lib/josa'

// ─────────────────────────────────────────────────────────────
// 의미 분석 + 클로저 컴파일
// 문장은 제너레이터 함수로 만들어 delay() 에서 멈췄다가 이어서 실행한다.
// 식은 사용자 함수/delay 를 포함하지 않으면 일반 함수(빠름)로 만든다.
// ─────────────────────────────────────────────────────────────

export class RuntimeError extends Error {
  constructor(public line: number, message: string) { super(message) }
}
class StopSignal extends Error {}

export interface Diagnostic { line: number; message: string; hint?: string }

export interface CallInfo { name: string; line: number; inFunc: string }

export interface TraceCall { name: string; pin: number | null; line: number; phase: 'setup' | 'loop'; count: number }

export interface Trace {
  calls: Map<string, TraceCall>
  pinModes: Map<number, string>
}

export interface Ctx {
  time: number
  steps: number
  yieldAt: number
  G: unknown[]
  hw: Hardware
  retVal: unknown
  depth: number
  line: number
  phase: 'setup' | 'loop'
  loops: number
  trace: Trace
  stopped: boolean
  txFreeAt: number
  rng: number
}

export interface StaticInfo {
  functions: string[]
  calls: CallInfo[]
  includes: string[]
  globals: string[]
}

type Frame = unknown[]
type Pure = (f: Frame) => unknown
type GenFn = (f: Frame) => Generator<undefined, unknown, undefined>
type SFn = (f: Frame) => Generator<undefined, number, undefined>

interface CE {
  ty: Ty
  gen: boolean
  fn: Pure | GenFn
  /** 배열 값 (배열 이름) */
  arr?: { len: number | null }
  constVal?: number
  line: number
}

interface VarSym {
  kind: 'var'
  name: string
  ty: Ty
  global: boolean
  slot: number
  isConst: boolean
  isRef: boolean
  arr: { len: number | null } | null
  constVal?: number
  line: number
  used: boolean
}

interface FnSym {
  kind: 'func'
  name: string
  def: FuncDef
  ret: Ty
  params: { ty: Ty; isRef: boolean; isArray: boolean; name: string }[]
  nLocals: number
  body: SFn | null
  locals?: number
}

const SIG_NORMAL = 0
const SIG_BREAK = 1
const SIG_CONTINUE = 2
const SIG_RETURN = 3
const YIELD_STEPS = 4000

const CONSTANTS: Record<string, [number, Ty]> = {
  HIGH: [1, 'int'], LOW: [0, 'int'], INPUT: [0, 'int'], OUTPUT: [1, 'int'], INPUT_PULLUP: [2, 'int'],
  LED_BUILTIN: [13, 'int'], A0: [14, 'int'], A1: [15, 'int'], A2: [16, 'int'], A3: [17, 'int'], A4: [18, 'int'], A5: [19, 'int'],
  DEC: [10, 'int'], HEX: [16, 'int'], BIN: [2, 'int'], OCT: [8, 'int'], PI: [Math.PI, 'float'], HALF_PI: [Math.PI / 2, 'float'],
  TWO_PI: [Math.PI * 2, 'float'], DHT11: [11, 'int'], DHT22: [22, 'int'], LSBFIRST: [0, 'int'], MSBFIRST: [1, 'int'],
  NAN: [NaN, 'float'], CHANGE: [1, 'int'], RISING: [3, 'int'], FALLING: [2, 'int'],
}

interface BuiltinDef { min: number; max: number; ret: Ty; yields?: boolean }
const BUILTINS: Record<string, BuiltinDef> = {
  pinMode: { min: 2, max: 2, ret: 'void' },
  digitalWrite: { min: 2, max: 2, ret: 'void' },
  digitalRead: { min: 1, max: 1, ret: 'int' },
  analogRead: { min: 1, max: 1, ret: 'int' },
  analogWrite: { min: 2, max: 2, ret: 'void' },
  delay: { min: 1, max: 1, ret: 'void', yields: true },
  delayMicroseconds: { min: 1, max: 1, ret: 'void' },
  millis: { min: 0, max: 0, ret: 'ulong' },
  micros: { min: 0, max: 0, ret: 'ulong' },
  pulseIn: { min: 2, max: 3, ret: 'ulong' },
  map: { min: 5, max: 5, ret: 'long' },
  constrain: { min: 3, max: 3, ret: 'long' },
  min: { min: 2, max: 2, ret: 'long' },
  max: { min: 2, max: 2, ret: 'long' },
  abs: { min: 1, max: 1, ret: 'long' },
  random: { min: 1, max: 2, ret: 'long' },
  randomSeed: { min: 1, max: 1, ret: 'void' },
  sqrt: { min: 1, max: 1, ret: 'float' },
  pow: { min: 2, max: 2, ret: 'float' },
  sin: { min: 1, max: 1, ret: 'float' },
  cos: { min: 1, max: 1, ret: 'float' },
  floor: { min: 1, max: 1, ret: 'float' },
  ceil: { min: 1, max: 1, ret: 'float' },
  round: { min: 1, max: 1, ret: 'long' },
  isnan: { min: 1, max: 1, ret: 'bool' },
  tone: { min: 2, max: 3, ret: 'void' },
  noTone: { min: 1, max: 1, ret: 'void' },
}
const SERIAL_METHODS: Record<string, BuiltinDef> = {
  begin: { min: 1, max: 2, ret: 'void' },
  print: { min: 1, max: 2, ret: 'ulong' },
  println: { min: 0, max: 2, ret: 'ulong' },
  write: { min: 1, max: 1, ret: 'ulong' },
  available: { min: 0, max: 0, ret: 'int' },
  read: { min: 0, max: 0, ret: 'int' },
  peek: { min: 0, max: 0, ret: 'int' },
  parseInt: { min: 0, max: 0, ret: 'long' },
  flush: { min: 0, max: 0, ret: 'void' },
  end: { min: 0, max: 0, ret: 'void' },
  setTimeout: { min: 1, max: 1, ret: 'void' },
}
const DHT11_METHODS: Record<string, BuiltinDef> = {
  readTemperatureHumidity: { min: 2, max: 2, ret: 'int' },
  readTemperature: { min: 0, max: 0, ret: 'int' },
  readHumidity: { min: 0, max: 0, ret: 'int' },
  setDelay: { min: 1, max: 1, ret: 'void' },
}
const DHT_METHODS: Record<string, BuiltinDef> = {
  begin: { min: 0, max: 1, ret: 'void' },
  readTemperature: { min: 0, max: 2, ret: 'float' },
  readHumidity: { min: 0, max: 1, ret: 'float' },
  computeHeatIndex: { min: 2, max: 3, ret: 'float' },
}
const STRING_METHODS: Record<string, BuiltinDef> = {
  length: { min: 0, max: 0, ret: 'uint' },
  toInt: { min: 0, max: 0, ret: 'long' },
  toFloat: { min: 0, max: 0, ret: 'float' },
  indexOf: { min: 1, max: 1, ret: 'int' },
  substring: { min: 1, max: 2, ret: 'String' },
  equals: { min: 1, max: 1, ret: 'bool' },
  charAt: { min: 1, max: 1, ret: 'char' },
  trim: { min: 0, max: 0, ret: 'void' },
}

const PIN_FNS = new Set(['pinMode', 'digitalWrite', 'digitalRead', 'analogRead', 'analogWrite', 'pulseIn'])
const MODE_NAMES = ['INPUT', 'OUTPUT', 'INPUT_PULLUP']

export const DHT11_ERRORS: Record<number, string> = {
  253: 'Error 253 Reading from DHT11 timed out.',
  254: 'Error 254 Checksum mismatch while reading from DHT11.',
}

// ── 이름 추천 (오타 도움말) ──
function editDistance(a: string, b: string) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return dp[a.length][b.length]
}
function suggest(name: string, candidates: string[]): string | null {
  const lower = name.toLowerCase()
  const exact = candidates.find((c) => c.toLowerCase() === lower)
  if (exact) return exact
  let best: string | null = null
  let bd = Math.max(1, Math.floor(name.length / 4))
  for (const c of candidates) {
    const d = editDistance(lower, c.toLowerCase())
    if (d <= bd) { bd = d; best = c }
  }
  return best
}

// ─────────────────────────────────────────────────────────────

export interface CompileResult {
  ok: boolean
  errors: Diagnostic[]
  warnings: Diagnostic[]
  info: StaticInfo
  /** 실행기 생성 (ok 일 때만) */
  createRunner?: (hw: Hardware) => Runner
}

export interface Runner {
  ctx: Ctx
  /** 가상 시간 untilUs 까지 또는 maxSteps 만큼 실행 */
  run(untilUs: number, maxSteps?: number): 'running' | 'done' | 'error'
  error: RuntimeError | null
  stop(): void
}

export function compileSource(src: string): CompileResult {
  const empty: StaticInfo = { functions: [], calls: [], includes: [], globals: [] }
  let program: Program
  let includes: string[] = []
  const warnings: Diagnostic[] = []
  try {
    const pre = preprocess(src)
    includes = pre.includes.map((i) => i.name)
    warnings.push(...pre.warnings)
    program = parse(pre.tokens)
  } catch (e) {
    if (e instanceof CompileError) return { ok: false, errors: [{ line: e.line, message: e.message, hint: e.hint }], warnings, info: { ...empty, includes } }
    throw e
  }
  // 정적 검사만 먼저 (실행용 ctx 는 가짜)
  try {
    const c = new Compiler(program, includes, warnings)
    c.compileAll()
    const info = c.info
    return {
      ok: true,
      errors: [],
      warnings: c.warnings,
      info,
      createRunner: (hw) => {
        const cc = new Compiler(program, includes, [])
        cc.compileAll()
        return cc.makeRunner(hw)
      },
    }
  } catch (e) {
    if (e instanceof CompileError) return { ok: false, errors: [{ line: e.line, message: e.message, hint: e.hint }], warnings, info: { ...empty, includes } }
    throw e
  }
}

class Compiler {
  globals = new Map<string, VarSym>()
  funcs = new Map<string, FnSym>()
  scopes: Map<string, VarSym>[] = []
  curFn: FnSym | null = null
  nGlobals = 0
  globalInits: SFn[] = []
  info: StaticInfo
  ctx: Ctx
  loopDepth = 0
  switchDepth = 0

  constructor(private program: Program, private includes: string[], public warnings: Diagnostic[]) {
    this.info = { functions: [], calls: [], includes, globals: [] }
    this.ctx = {
      time: 0, steps: 0, yieldAt: YIELD_STEPS, G: [], hw: null as unknown as Hardware, retVal: undefined, depth: 0, line: 0,
      phase: 'setup', loops: 0, trace: { calls: new Map(), pinModes: new Map() }, stopped: false, txFreeAt: 0, rng: 12345,
    }
  }

  err(line: number, msg: string, hint?: string): never {
    throw new CompileError(line, msg, hint)
  }

  // ── 최상위 ──
  compileAll() {
    // 1) 함수 이름 먼저 모으기 (아두이노는 선언 전 호출을 허용)
    for (const it of this.program.items) {
      if (it.k !== 'func') continue
      const ret = it.ret.base as Ty
      const params = it.params.map((p) => ({ ty: p.type.base as Ty, isRef: p.isRef, isArray: p.isArray, name: p.name }))
      const prev = this.funcs.get(it.name)
      if (prev) {
        if (prev.def.body && it.body) this.err(it.line, `함수 ${it.name}() 가 두 번 만들어졌어요.`)
        if (it.body) { prev.def = it; prev.params = params; prev.ret = ret }
        continue
      }
      if (this.globals.has(it.name)) this.err(it.line, `${it.name} 은(는) 이미 변수 이름으로 쓰였어요.`)
      this.funcs.set(it.name, { kind: 'func', name: it.name, def: it, ret, params, nLocals: 0, body: null })
    }
    for (const f of this.funcs.values()) {
      if (!f.def.body) this.err(f.def.line, `함수 ${f.name}() 의 선언만 있고 내용({ })이 없어요.`)
    }
    // 2) 순서대로 전역 변수 / 함수 본문 컴파일
    for (const it of this.program.items) {
      if (it.k === 'var') this.globalVar(it)
    }
    for (const it of this.program.items) {
      if (it.k === 'func' && it.body) this.compileFunc(this.funcs.get(it.name)!)
    }
    for (const name of ['setup', 'loop']) {
      const f = this.funcs.get(name)
      if (!f) {
        const near = suggest(name, [...this.funcs.keys()])
        this.err(1, `${name}() 함수가 없어요. void ${name}() { ... } 를 만들어 주세요.${near ? ` (혹시 ${near} 로 쓰지 않았나요? 대소문자를 확인하세요.)` : ''}`)
      }
      if (f.params.length) this.err(f.def.line, `${name}() 는 매개변수가 없어야 해요.`)
      if (f.ret !== 'void') this.warnings.push({ line: f.def.line, message: `${name}() 는 보통 void ${name}() 으로 만들어요.` })
    }
    this.info.functions = [...this.funcs.keys()]
    this.info.globals = [...this.globals.keys()]
  }

  globalVar(d: VarDecl) {
    for (const dc of d.decls) {
      if (this.globals.has(dc.name)) this.err(dc.line, `변수 ${dc.name} 이(가) 두 번 선언됐어요.`)
      if (this.funcs.has(dc.name)) this.err(dc.line, `${dc.name} 은(는) 이미 함수 이름으로 쓰였어요.`)
      const sym = this.declare(d, dc, true)
      this.globals.set(dc.name, sym)
      const init = this.initializer(d, dc, sym)
      if (init) this.globalInits.push(init)
    }
  }

  declare(d: VarDecl, dc: Declarator, global: boolean): VarSym {
    const ty = d.type.base as Ty
    if (ty === 'void') this.err(dc.line, 'void 는 변수 자료형으로 쓸 수 없어요.')
    if ((ty === 'DHT11' || ty === 'DHT') && !this.includes.some((i) => i === `${ty}.h`)) {
      this.err(dc.line, `${ty} 를 쓰려면 맨 위에 #include <${ty}.h> 가 필요해요.`)
    }
    let arr: VarSym['arr'] = null
    if (dc.array) {
      let len: number | null = null
      if (dc.array.size) {
        const s = this.expr(dc.array.size)
        if (s.constVal === undefined) this.err(dc.line, '배열 크기는 상수여야 해요. 예: int pins[3];')
        len = s.constVal
      } else if (dc.init?.k === 'initlist') len = dc.init.items.length
      else if (dc.init?.k === 'str') len = dc.init.value.length + 1
      else this.err(dc.line, '배열 크기를 정하거나 { } 로 초기값을 주세요.')
      arr = { len }
    }
    const slot = global ? this.nGlobals++ : this.curFn!.nLocals++
    const sym: VarSym = { kind: 'var', name: dc.name, ty, global, slot, isConst: d.type.isConst, isRef: false, arr, line: dc.line, used: false }
    if (d.type.isConst && !arr && dc.init && dc.init.k !== 'initlist') {
      const v = this.tryConst(dc.init)
      if (v !== undefined && isNum(ty)) sym.constVal = conv(v, ty)
    }
    if (d.type.isStatic && !global) {
      // static 지역 변수는 전역 슬롯에 둔다
      sym.global = true
      sym.slot = this.nGlobals++
      this.curFn!.nLocals--
    }
    return sym
  }

  tryConst(e: Expr): number | undefined {
    try {
      const c = this.expr(e)
      return c.constVal
    } catch {
      return undefined
    }
  }

  /** 변수 초기화 문장 */
  initializer(_d: VarDecl, dc: Declarator, sym: VarSym): SFn | null {
    const ctx = this.ctx
    const store = (f: Frame) => (sym.global ? ctx.G : f)
    const ty = sym.ty
    const line = dc.line
    if (ty === 'DHT11' || ty === 'DHT') {
      const args = (dc.ctorArgs ?? []).map((a) => this.expr(a))
      if (ty === 'DHT11' && args.length !== 1) this.err(line, 'DHT11 은 핀 번호 하나가 필요해요. 예: DHT11 dht11(2);')
      if (ty === 'DHT' && args.length < 2) this.err(line, 'DHT 는 (핀, 센서종류) 두 값이 필요해요. 예: DHT dht(2, DHT11);')
      const pinFn = this.pure(args[0])
      return function* (f) {
        const pin = Number(pinFn(f))
        store(f)[sym.slot] = ty === 'DHT11' ? { pin, delayMs: 500 } : { pin, begun: false, last: -1e12, t: NaN, h: NaN }
        return SIG_NORMAL
      }
    }
    if (sym.arr) {
      const len = sym.arr.len!
      const items: CE[] = []
      if (dc.init?.k === 'initlist') {
        if (dc.init.items.length > len) this.err(line, `배열 크기(${len})보다 초기값이 많아요.`)
        for (const it of dc.init.items) items.push(this.expr(it))
      } else if (dc.init?.k === 'str') {
        for (const ch of dc.init.value) items.push({ ty: 'char', gen: false, fn: () => ch.charCodeAt(0), line })
      } else if (dc.init) this.err(line, '배열은 { 1, 2, 3 } 처럼 초기화해요.')
      for (const it of items) this.checkAssignable(ty, it, line)
      const fns = items.map((i) => this.pure(i))
      return function* (f) {
        const a = new Array(len).fill(ty === 'String' ? '' : 0)
        for (let i = 0; i < fns.length; i++) a[i] = convAny(fns[i](f), ty)
        store(f)[sym.slot] = a
        return SIG_NORMAL
      }
    }
    let initE: CE | null = null
    if (dc.init) {
      if (dc.init.k === 'initlist') this.err(line, '{ } 초기화는 배열에서만 쓸 수 있어요.')
      initE = this.expr(dc.init)
    } else if (dc.ctorArgs && dc.ctorArgs.length === 1) initE = this.expr(dc.ctorArgs[0])
    if (initE) this.checkAssignable(ty, initE, line)
    const def = ty === 'String' ? '' : 0
    if (!initE) return function* (f) { store(f)[sym.slot] = def; return SIG_NORMAL }
    const ie = initE
    if (!ie.gen) {
      const fn = ie.fn as Pure
      return function* (f) { ctx.line = line; store(f)[sym.slot] = convAny(fn(f), ty); return SIG_NORMAL }
    }
    const g = ie.fn as GenFn
    return function* (f) { ctx.line = line; store(f)[sym.slot] = convAny(yield* g(f), ty); return SIG_NORMAL }
  }

  checkAssignable(target: Ty, e: CE, line: number) {
    if (e.arr) this.err(line, '배열 전체를 한 번에 대입할 수 없어요. 요소 하나씩 대입하세요.')
    if (e.ty === 'void') this.err(line, '값을 돌려주지 않는(void) 함수의 결과는 변수에 넣을 수 없어요.')
    if (isNum(target) && isText(e.ty)) this.err(line, `숫자 변수(${TYPE_KO[target]})에 글자를 넣을 수 없어요.`)
    if (target === 'String' && !isText(e.ty) && !isNum(e.ty)) this.err(line, 'String 변수에 넣을 수 없는 값이에요.')
    if ((target === 'DHT11' || target === 'DHT') !== (e.ty === 'DHT11' || e.ty === 'DHT')) this.err(line, `${TYPE_KO[target]} 에 이 값을 넣을 수 없어요.`)
  }

  // ── 함수 ──
  compileFunc(fn: FnSym) {
    this.curFn = fn
    this.scopes = [new Map()]
    fn.nLocals = 0
    for (const p of fn.def.params) {
      const ty = p.type.base as Ty
      if (this.scopes[0].has(p.name)) this.err(p.line, `매개변수 ${p.name} 이(가) 두 번 있어요.`)
      this.scopes[0].set(p.name, {
        kind: 'var', name: p.name, ty, global: false, slot: fn.nLocals++, isConst: p.type.isConst, isRef: p.isRef,
        arr: p.isArray ? { len: null } : null, line: p.line, used: false,
      })
    }
    const body = this.block(fn.def.body!, false)
    fn.body = body
    this.curFn = null
  }

  // ── 문장 ──
  block(b: Block, newScope = true): SFn {
    if (newScope) this.scopes.push(new Map())
    const stmts = b.body.map((s) => this.stmt(s))
    if (newScope) this.scopes.pop()
    const n = stmts.length
    if (n === 1) return stmts[0]
    return function* (f) {
      for (let i = 0; i < n; i++) {
        const s = yield* stmts[i](f)
        if (s !== SIG_NORMAL) return s
      }
      return SIG_NORMAL
    }
  }

  lookup(name: string): VarSym | undefined {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const s = this.scopes[i].get(name)
      if (s) return s
    }
    return this.globals.get(name)
  }

  stmt(s: Stmt): SFn {
    const ctx = this.ctx
    const line = s.line
    switch (s.k) {
      case 'block': return this.block(s)
      case 'empty': return function* () { return SIG_NORMAL }
      case 'var': {
        const fns: SFn[] = []
        for (const dc of s.decls) {
          const scope = this.scopes[this.scopes.length - 1]
          if (scope.has(dc.name)) this.err(dc.line, `변수 ${dc.name} 이(가) 같은 범위에서 두 번 선언됐어요.`)
          const sym = this.declare(s, dc, false)
          // 초기값 식은 변수 등록 전에 컴파일 (int x = x; 방지)
          const init = this.initializer(s, dc, sym)
          scope.set(dc.name, sym)
          if (init) {
            if (s.type.isStatic) {
              // static: 최초 한 번만 초기화
              let done = false
              fns.push(function* (f) { if (!done) { done = true; yield* init(f) } return SIG_NORMAL })
            } else fns.push(init)
          }
        }
        return function* (f) {
          ctx.steps++
          ctx.time += 1
          for (const fn of fns) yield* fn(f)
          return SIG_NORMAL
        }
      }
      case 'expr': {
        const e = this.expr(s.e, true)
        this.checkUselessExpr(s.e)
        if (!e.gen) {
          const fn = e.fn as Pure
          return function* (f) {
            ctx.line = line
            ctx.steps++
            ctx.time += 1
            fn(f)
            return SIG_NORMAL
          }
        }
        const g = e.fn as GenFn
        return function* (f) {
          ctx.line = line
          ctx.steps++
          ctx.time += 1
          yield* g(f)
          return SIG_NORMAL
        }
      }
      case 'if': {
        this.checkCondAssign(s.cond)
        const c = this.condFn(s.cond)
        const th = this.scoped(s.then)
        const el = s.else ? this.scoped(s.else) : null
        return function* (f) {
          ctx.line = line
          ctx.steps++
          ctx.time += 1
          const v = c.gen ? yield* (c.fn as GenFn)(f) : (c.fn as Pure)(f)
          if (v) return yield* th(f)
          if (el) return yield* el(f)
          return SIG_NORMAL
        }
      }
      case 'while':
      case 'do': {
        this.checkCondAssign(s.cond)
        const c = this.condFn(s.cond)
        this.loopDepth++
        const body = this.scoped(s.body)
        this.loopDepth--
        const isDo = s.k === 'do'
        return function* (f) {
          let first = isDo
          for (;;) {
            ctx.line = line
            ctx.steps++
            ctx.time += 1
            if (ctx.stopped) throw new StopSignal()
            if (!first) {
              const v = c.gen ? yield* (c.fn as GenFn)(f) : (c.fn as Pure)(f)
              if (!v) break
            }
            first = false
            const r = yield* body(f)
            if (r === SIG_BREAK) break
            if (r === SIG_RETURN) return r
            if (ctx.steps >= ctx.yieldAt) { ctx.yieldAt = ctx.steps + YIELD_STEPS; yield }
          }
          return SIG_NORMAL
        }
      }
      case 'for': {
        this.scopes.push(new Map())
        const init = s.init ? this.stmt(s.init) : null
        if (s.cond) this.checkCondAssign(s.cond)
        const c = s.cond ? this.condFn(s.cond) : null
        const upd = s.update ? this.expr(s.update, true) : null
        this.loopDepth++
        const body = this.scoped(s.body)
        this.loopDepth--
        this.scopes.pop()
        return function* (f) {
          if (init) yield* init(f)
          for (;;) {
            ctx.line = line
            ctx.steps++
            ctx.time += 1
            if (ctx.stopped) throw new StopSignal()
            if (c) {
              const v = c.gen ? yield* (c.fn as GenFn)(f) : (c.fn as Pure)(f)
              if (!v) break
            }
            const r = yield* body(f)
            if (r === SIG_BREAK) break
            if (r === SIG_RETURN) return r
            if (upd) { if (upd.gen) yield* (upd.fn as GenFn)(f); else (upd.fn as Pure)(f) }
            if (ctx.steps >= ctx.yieldAt) { ctx.yieldAt = ctx.steps + YIELD_STEPS; yield }
          }
          return SIG_NORMAL
        }
      }
      case 'break':
        if (!this.loopDepth && !this.switchDepth) this.err(line, 'break 는 반복문(for, while)이나 switch 안에서만 쓸 수 있어요.')
        return function* () { return SIG_BREAK }
      case 'continue':
        if (!this.loopDepth) this.err(line, 'continue 는 반복문 안에서만 쓸 수 있어요.')
        return function* () { return SIG_CONTINUE }
      case 'return': {
        const fn = this.curFn!
        if (!s.e) {
          if (fn.ret !== 'void') this.warnings.push({ line, message: `${fn.name}() 는 값을 돌려줘야 해요 (return 값;).` })
          return function* () { ctx.retVal = 0; return SIG_RETURN }
        }
        if (fn.ret === 'void') this.err(line, `void 함수 ${fn.name}() 에서는 값을 return 할 수 없어요.`)
        const e = this.expr(s.e)
        this.checkAssignable(fn.ret, e, line)
        const ret = fn.ret
        if (!e.gen) {
          const p = e.fn as Pure
          return function* (f) { ctx.line = line; ctx.retVal = convAny(p(f), ret); return SIG_RETURN }
        }
        const g = e.fn as GenFn
        return function* (f) { ctx.line = line; ctx.retVal = convAny(yield* g(f), ret); return SIG_RETURN }
      }
      case 'switch': {
        const d = this.expr(s.disc)
        if (!isInt(d.ty)) this.err(line, 'switch 에는 정수 값만 쓸 수 있어요.')
        const dfn = this.genOf(d)
        this.switchDepth++
        this.scopes.push(new Map())
        const cases = s.cases.map((c) => {
          let test: number | null = null
          if (c.test) {
            const tv = this.expr(c.test)
            if (tv.constVal === undefined) this.err(c.line, 'case 값은 상수여야 해요.')
            test = tv.constVal
          }
          return { test, body: c.body.map((b) => this.stmt(b)) }
        })
        this.scopes.pop()
        this.switchDepth--
        return function* (f) {
          ctx.line = line
          const v = yield* dfn(f)
          let idx = cases.findIndex((c) => c.test !== null && c.test === v)
          if (idx < 0) idx = cases.findIndex((c) => c.test === null)
          if (idx < 0) return SIG_NORMAL
          for (let i = idx; i < cases.length; i++) {
            for (const st of cases[i].body) {
              const r = yield* st(f)
              if (r === SIG_BREAK) return SIG_NORMAL
              if (r !== SIG_NORMAL) return r
            }
          }
          return SIG_NORMAL
        }
      }
    }
  }

  /** if/for 몸통처럼 새 범위를 만드는 문장 (continue 처리 포함) */
  scoped(s: Stmt): SFn {
    this.scopes.push(new Map())
    const r = this.stmt(s)
    this.scopes.pop()
    return r
  }

  condFn(e: Expr): CE {
    const c = this.expr(e)
    if (c.ty === 'void') this.err(e.line, '조건에 값이 없는 함수 호출을 썼어요.')
    if (c.ty === 'DHT11' || c.ty === 'DHT') this.err(e.line, '조건에 쓸 수 없는 값이에요.')
    return c
  }

  checkCondAssign(e: Expr) {
    if (e.k === 'assign' && e.op === '=') {
      this.warnings.push({ line: e.line, message: '조건 안에 = (대입) 을 썼어요. 같은지 비교하려면 == 를 써야 해요.' })
    }
  }

  checkUselessExpr(e: Expr) {
    if (e.k === 'binary' && e.op === '==' ) {
      this.warnings.push({ line: e.line, message: '== 는 비교만 하고 아무것도 바꾸지 않아요. 값을 넣으려면 = 를 쓰세요.' })
    }
    if (e.k === 'ident') this.warnings.push({ line: e.line, message: `${e.name} 만 단독으로 쓰면 아무 일도 일어나지 않아요. 함수라면 ${e.name}() 처럼 괄호가 필요해요.` })
  }

  // ── 식 ──
  pure(e: CE): Pure {
    if (e.gen) this.err(e.line, '여기에서는 함수 호출(사용자 함수, delay)을 쓸 수 없어요.')
    return e.fn as Pure
  }
  genOf(e: CE): GenFn {
    if (e.gen) return e.fn as GenFn
    const p = e.fn as Pure
    return function* (f) { return p(f) }
  }

  mk(ty: Ty, parts: CE[], line: number, compute: (...v: any[]) => unknown, constVal?: number): CE {
    const gen = parts.some((p) => p.gen)
    if (!gen) {
      const fs = parts.map((p) => p.fn as Pure)
      let fn: Pure
      if (fs.length === 0) fn = () => compute()
      else if (fs.length === 1) { const [a] = fs; fn = (f) => compute(a(f)) }
      else if (fs.length === 2) { const [a, b] = fs; fn = (f) => compute(a(f), b(f)) }
      else if (fs.length === 3) { const [a, b, c] = fs; fn = (f) => compute(a(f), b(f), c(f)) }
      else fn = (f) => compute(...fs.map((x) => x(f)))
      return { ty, gen: false, fn, line, constVal }
    }
    const gs = parts.map((p) => this.genOf(p))
    const fn: GenFn = function* (f) {
      const vals: unknown[] = []
      for (const g of gs) vals.push(yield* g(f))
      return compute(...vals)
    }
    return { ty, gen: true, fn, line }
  }

  expr(e: Expr, asStmt = false): CE {
    const ctx = this.ctx
    const line = e.line
    switch (e.k) {
      case 'num': {
        const v = e.ntype === 'float' ? Math.fround(e.value) : e.value
        return { ty: e.ntype, gen: false, fn: () => v, line, constVal: v }
      }
      case 'char': return { ty: 'char', gen: false, fn: () => e.value, line, constVal: e.value }
      case 'str': { const v = e.value; return { ty: 'cstr', gen: false, fn: () => v, line } }
      case 'ident': return this.identExpr(e.name, line)
      case 'scoped': {
        if (e.ns === 'DHT11' && (e.name === 'ERROR_TIMEOUT' || e.name === 'ERROR_CHECKSUM')) {
          const v = e.name === 'ERROR_TIMEOUT' ? 253 : 254
          return { ty: 'int', gen: false, fn: () => v, line, constVal: v }
        }
        this.err(line, `${e.ns}::${e.name} 는 지원하지 않아요.`)
      }
      // falls through
      case 'binary': return this.binary(e.op, this.expr(e.l), this.expr(e.r), line)
      case 'logical': {
        const l = this.expr(e.l)
        const r = this.expr(e.r)
        for (const x of [l, r]) if (x.ty === 'void' || isText(x.ty) || x.arr) this.err(line, `${e.op} 양쪽에는 참/거짓 조건이 와야 해요.`)
        const and = e.op === '&&'
        const cv = l.constVal !== undefined && r.constVal !== undefined ? (and ? (l.constVal && r.constVal ? 1 : 0) : (l.constVal || r.constVal ? 1 : 0)) : undefined
        if (!l.gen && !r.gen) {
          const a = l.fn as Pure
          const b = r.fn as Pure
          return { ty: 'bool', gen: false, line, constVal: cv, fn: and ? (f) => (a(f) && b(f) ? 1 : 0) : (f) => (a(f) || b(f) ? 1 : 0) }
        }
        const a = this.genOf(l)
        const b = this.genOf(r)
        return {
          ty: 'bool', gen: true, line,
          fn: function* (f) {
            const x = yield* a(f)
            if (and ? !x : x) return and ? 0 : 1
            return (yield* b(f)) ? 1 : 0
          },
        }
      }
      case 'unary': {
        const a = this.expr(e.e)
        if (a.arr || a.ty === 'void') this.err(line, `'${e.op}' 를 쓸 수 없는 값이에요.`)
        if (e.op === '!') return this.mk('bool', [a], line, (v) => (v ? 0 : 1), a.constVal !== undefined ? (a.constVal ? 0 : 1) : undefined)
        if (!isNum(a.ty)) this.err(line, `글자에는 '${e.op}' 를 쓸 수 없어요.`)
        const t = unaryType(a.ty)
        if (e.op === '-') return this.mk(t, [a], line, (v) => conv(-v, t), a.constVal !== undefined ? conv(-a.constVal, t) : undefined)
        if (e.op === '+') return this.mk(t, [a], line, (v) => conv(v, t), a.constVal)
        if (t === 'float') this.err(line, '실수(float)에는 ~ 를 쓸 수 없어요.')
        return this.mk(t, [a], line, (v) => conv(~v, t), a.constVal !== undefined ? conv(~a.constVal, t) : undefined)
      }
      case 'update': {
        const lv = this.lvalue(e.target, line)
        if (!isNum(lv.ty)) this.err(line, `${e.op} 는 숫자 변수에만 쓸 수 있어요.`)
        const ty = lv.ty
        const d = e.op === '++' ? 1 : -1
        const { get, set } = lv
        if (e.prefix) return { ty, gen: false, line, fn: (f) => { const v = conv((get(f) as number) + d, ty); set(f, v); return v } }
        return { ty, gen: false, line, fn: (f) => { const old = get(f) as number; set(f, conv(old + d, ty)); return old } }
      }
      case 'assign': {
        const lv = this.lvalue(e.target, line)
        const val = this.expr(e.value)
        const ty = lv.ty
        let compute: (old: unknown, v: unknown) => unknown
        if (e.op === '=') {
          this.checkAssignable(ty, val, line)
          compute = (_o, v) => convAny(v, ty)
        } else {
          const op = e.op.slice(0, -1)
          const fake: CE = { ty, gen: false, fn: () => 0, line }
          const bin = this.binaryFn(op, fake, val, line)
          compute = (o, v) => convAny(bin.op(o, v), ty)
        }
        const { get, set } = lv
        if (!val.gen) {
          const vf = val.fn as Pure
          const isPlain = e.op === '='
          return { ty, gen: false, line, fn: isPlain ? (f) => { const v = convAny(vf(f), ty); set(f, v); return v } : (f) => { const v = compute(get(f), vf(f)); set(f, v); return v } }
        }
        const vg = val.fn as GenFn
        return { ty, gen: true, line, fn: function* (f) { const v = compute(get(f), yield* vg(f)); set(f, v); return v } }
      }
      case 'cond': {
        const t = this.expr(e.test)
        const a = this.expr(e.a)
        const b = this.expr(e.b)
        let ty: Ty = a.ty
        if (isNum(a.ty) && isNum(b.ty)) ty = arithType(a.ty, b.ty)
        else if (isText(a.ty) || isText(b.ty)) ty = a.ty === 'String' || b.ty === 'String' ? 'String' : 'cstr'
        if (!t.gen && !a.gen && !b.gen) {
          const tf = t.fn as Pure, af = a.fn as Pure, bf = b.fn as Pure
          return { ty, gen: false, line, fn: (f) => convAny(tf(f) ? af(f) : bf(f), ty) }
        }
        const tg = this.genOf(t), ag = this.genOf(a), bg = this.genOf(b)
        return { ty, gen: true, line, fn: function* (f) { return convAny((yield* tg(f)) ? yield* ag(f) : yield* bg(f), ty) } }
      }
      case 'cast': return this.cast(e.type as Ty, e.args ?? [e.e], line)
      case 'sizeof': {
        if (e.type) {
          const s = SIZEOF[e.type as Ty]
          if (s === undefined) this.err(line, `sizeof(${e.type}) 는 지원하지 않아요.`)
          return { ty: 'ulong', gen: false, fn: () => s, line, constVal: s }
        }
        const x = this.expr(e.e!)
        const unit = SIZEOF[x.ty] ?? 1
        const size = x.arr ? (x.arr.len ?? 0) * unit : x.ty === 'cstr' ? 0 : unit
        if (x.arr && x.arr.len == null) this.err(line, '매개변수로 받은 배열의 크기는 sizeof 로 알 수 없어요.')
        return { ty: 'ulong', gen: false, fn: () => size, line, constVal: size }
      }
      case 'comma': {
        const parts = e.list.map((x) => this.expr(x, true))
        const last = parts[parts.length - 1]
        return this.mk(last.ty, parts, line, (...v) => v[v.length - 1])
      }
      case 'index': {
        const a = this.expr(e.obj)
        const i = this.expr(e.index)
        if (!isInt(i.ty)) this.err(line, '배열 위치(인덱스)는 정수여야 해요.')
        if (a.ty === 'String' && !a.arr) {
          return this.mk('char', [a, i], line, (s: string, k: number) => (k >= 0 && k < s.length ? s.charCodeAt(k) : 0))
        }
        if (!a.arr) this.err(line, '배열이 아닌 값에 [ ] 를 썼어요.')
        const ty = a.ty
        return this.mk(ty, [a, i], line, (arr: unknown[], k: number) => {
          if (k < 0 || k >= arr.length) throw new RuntimeError(ctx.line, `배열 범위를 벗어났어요 (크기 ${arr.length}, 위치 ${k}).`)
          return arr[k]
        })
      }
      case 'call': return this.call(e, asStmt)
      case 'member': {
        if (e.obj.k === 'ident' && e.obj.name === 'Serial') this.err(line, `Serial.${e.prop} 다음에 괄호 () 가 필요해요.`)
        this.err(line, `.${e.prop} 는 지원하지 않는 사용법이에요.`)
      }
      // falls through
      case 'initlist': this.err(line, '{ } 는 배열을 선언할 때만 쓸 수 있어요.')
    }
    return this.err(line, '알 수 없는 식이에요.')
  }

  identExpr(name: string, line: number): CE {
    const ctx = this.ctx
    const sym = this.lookup(name)
    if (sym) {
      sym.used = true
      const slot = sym.slot
      if (sym.constVal !== undefined) { const v = sym.constVal; return { ty: sym.ty, gen: false, fn: () => v, line, constVal: v } }
      let fn: Pure
      if (sym.isRef) fn = (f) => (f[slot] as Ref).get()
      else if (sym.global) { const G = ctx.G; fn = () => G[slot] }
      else fn = (f) => f[slot]
      return { ty: sym.ty, gen: false, fn, line, arr: sym.arr ?? undefined }
    }
    const c = CONSTANTS[name]
    if (c) { const [v, ty] = c; return { ty, gen: false, fn: () => v, line, constVal: v } }
    if (this.funcs.has(name) || BUILTINS[name]) this.err(line, `${name} 은(는) 함수예요. ${name}() 처럼 괄호를 붙여 호출하세요.`)
    const cands = [...this.globals.keys(), ...this.scopes.flatMap((s) => [...s.keys()]), ...Object.keys(CONSTANTS)]
    const near = suggest(name, cands)
    if (name === 'serial') this.err(line, 'serial 이 아니라 대문자 Serial 로 써야 해요.')
    this.err(line, `변수 ${josa(name, '이가')} 선언되지 않았어요.${near ? ` 혹시 ${near} 인가요?` : ` 사용하기 전에 int ${name} = 0; 처럼 선언하세요.`}`)
  }

  lvalue(e: Expr, line: number): { ty: Ty; get: Pure; set: (f: Frame, v: unknown) => void } {
    const ctx = this.ctx
    if (e.k === 'ident') {
      const sym = this.lookup(e.name)
      if (!sym) {
        if (CONSTANTS[e.name]) this.err(line, `${e.name} 은(는) 상수라서 값을 바꿀 수 없어요.`)
        return this.identExpr(e.name, line) as never
      }
      if (sym.isConst) this.err(line, `상수 ${e.name} 의 값은 바꿀 수 없어요 (const).`)
      if (sym.arr) this.err(line, `배열 ${e.name} 전체에는 대입할 수 없어요. ${e.name}[0] = ... 처럼 요소에 대입하세요.`)
      sym.used = true
      const slot = sym.slot
      if (sym.isRef) return { ty: sym.ty, get: (f) => (f[slot] as Ref).get(), set: (f, v) => (f[slot] as Ref).set(v) }
      if (sym.global) { const G = ctx.G; return { ty: sym.ty, get: () => G[slot], set: (_f, v) => { G[slot] = v } } }
      return { ty: sym.ty, get: (f) => f[slot], set: (f, v) => { f[slot] = v } }
    }
    if (e.k === 'index') {
      const a = this.expr(e.obj)
      if (!a.arr) this.err(line, '배열이 아닌 값에 [ ] 를 썼어요.')
      if (e.obj.k === 'ident' && this.lookup(e.obj.name)?.isConst) this.err(line, `상수 배열 ${e.obj.name} 의 값은 바꿀 수 없어요.`)
      const af = this.pure(a)
      const idx = this.expr(e.index)
      const ifn = this.pure(idx)
      const chk = (arr: unknown[], k: number) => {
        if (k < 0 || k >= arr.length) throw new RuntimeError(ctx.line, `배열 범위를 벗어났어요 (크기 ${arr.length}, 위치 ${k}).`)
      }
      return {
        ty: a.ty,
        get: (f) => { const arr = af(f) as unknown[]; const k = ifn(f) as number; chk(arr, k); return arr[k] },
        set: (f, v) => { const arr = af(f) as unknown[]; const k = ifn(f) as number; chk(arr, k); arr[k] = v },
      }
    }
    this.err(line, '이 값에는 대입할 수 없어요. 왼쪽에는 변수 이름이 와야 해요.')
  }

  binaryFn(op: string, l: CE, r: CE, line: number): { ty: Ty; op: (a: any, b: any) => unknown } {
    const ctx = this.ctx
    if (l.arr || r.arr) this.err(line, `배열에는 '${op}' 를 쓸 수 없어요. 배열[번호] 로 요소를 쓰세요.`)
    if (l.ty === 'void' || r.ty === 'void') this.err(line, '값을 돌려주지 않는(void) 함수의 결과는 계산에 쓸 수 없어요.')
    if (l.ty === 'DHT11' || l.ty === 'DHT' || r.ty === 'DHT11' || r.ty === 'DHT') this.err(line, `센서 객체에는 '${op}' 를 쓸 수 없어요.`)
    const ls = l.ty === 'String'
    const rs = r.ty === 'String'
    if (ls || rs || isText(l.ty) || isText(r.ty)) {
      if (op === '+') {
        if (!ls && !rs) this.err(line, '"글자" 와 다른 값을 + 로 이어 붙이려면 String("글자") + 값 처럼 String 으로 감싸야 해요.')
        const lt = l.ty, rt = r.ty
        return { ty: 'String', op: (a, b) => formatValue(a, lt) + formatValue(b, rt) }
      }
      if (op === '==' || op === '!=' || op === '<' || op === '>' || op === '<=' || op === '>=') {
        if (!(isText(l.ty) && isText(r.ty))) this.err(line, '글자와 숫자는 비교할 수 없어요.')
        const cmp: Record<string, (a: string, b: string) => boolean> = {
          '==': (a, b) => a === b, '!=': (a, b) => a !== b, '<': (a, b) => a < b, '>': (a, b) => a > b, '<=': (a, b) => a <= b, '>=': (a, b) => a >= b,
        }
        const c = cmp[op]
        return { ty: 'bool', op: (a, b) => (c(String(a), String(b)) ? 1 : 0) }
      }
      this.err(line, `글자에는 '${op}' 를 쓸 수 없어요.`)
    }
    const ty = arithType(l.ty, r.ty)
    const intT = ty !== 'float'
    switch (op) {
      case '+': return { ty, op: (a, b) => conv(a + b, ty) }
      case '-': return { ty, op: (a, b) => conv(a - b, ty) }
      case '*': return { ty, op: ty === 'long' || ty === 'ulong' ? (a, b) => conv(Math.imul(a, b), ty) : (a, b) => conv(a * b, ty) }
      case '/':
        if (!intT) return { ty, op: (a, b) => conv(a / b, ty) }
        return { ty, op: (a, b) => { if (b === 0) throw new RuntimeError(ctx.line, '0으로 나눴어요. 나누는 값이 0이 되지 않게 하세요.'); return conv(a / b, ty) } }
      case '%':
        if (!intT) this.err(line, '실수(float)에는 % 를 쓸 수 없어요. 정수로 바꾸거나 fmod 를 쓰세요.')
        return { ty, op: (a, b) => { if (b === 0) throw new RuntimeError(ctx.line, '0으로 나머지를 구했어요 (% 0).'); return conv(a % b, ty) } }
      case '&': case '|': case '^': case '<<': case '>>': {
        if (!intT) this.err(line, `실수(float)에는 '${op}' 를 쓸 수 없어요.`)
        const t = op === '<<' || op === '>>' ? unaryType(l.ty) : ty
        const unsigned = t === 'uint' || t === 'ulong'
        const f: Record<string, (a: number, b: number) => number> = {
          '&': (a, b) => a & b, '|': (a, b) => a | b, '^': (a, b) => a ^ b, '<<': (a, b) => a << b, '>>': unsigned ? (a, b) => a >>> b : (a, b) => a >> b,
        }
        const g = f[op]
        return { ty: t, op: (a, b) => conv(g(a, b), t) }
      }
      case '==': return { ty: 'bool', op: (a, b) => (a === b ? 1 : 0) }
      case '!=': return { ty: 'bool', op: (a, b) => (a !== b ? 1 : 0) }
      case '<': return { ty: 'bool', op: (a, b) => (a < b ? 1 : 0) }
      case '>': return { ty: 'bool', op: (a, b) => (a > b ? 1 : 0) }
      case '<=': return { ty: 'bool', op: (a, b) => (a <= b ? 1 : 0) }
      case '>=': return { ty: 'bool', op: (a, b) => (a >= b ? 1 : 0) }
    }
    this.err(line, `연산자 '${op}' 는 지원하지 않아요.`)
  }

  binary(op: string, l: CE, r: CE, line: number): CE {
    const b = this.binaryFn(op, l, r, line)
    let cv: number | undefined
    if (l.constVal !== undefined && r.constVal !== undefined) {
      try { const v = b.op(l.constVal, r.constVal); if (typeof v === 'number') cv = v } catch { cv = undefined }
    }
    return this.mk(b.ty, [l, r], line, b.op, cv)
  }

  cast(ty: Ty, args: Expr[], line: number): CE {
    const xs = args.map((a) => this.expr(a))
    const x = xs[0]
    if (ty === 'String') {
      if (xs.length === 2) {
        const fmt = xs[1]
        const xt = x.ty
        return this.mk('String', [x, fmt], line, (v, f) => formatValue(v, xt, f as number))
      }
      const xt = x.ty
      return this.mk('String', [x], line, (v) => (typeof v === 'string' ? v : formatValue(v, xt === 'char' ? 'char' : xt)))
    }
    if (isText(x.ty)) this.err(line, `글자를 (${TYPE_KO[ty]}) 로 바꿀 수 없어요. 숫자로 바꾸려면 문자열.toInt() 를 쓰세요.`)
    return this.mk(ty, [x], line, (v) => conv(v, ty), x.constVal !== undefined ? conv(x.constVal, ty) : undefined)
  }

  // ── 함수 호출 ──
  recordCall(name: string, line: number) {
    this.info.calls.push({ name, line, inFunc: this.curFn?.name ?? '(전역)' })
  }

  arity(name: string, def: BuiltinDef, n: number, line: number, label?: string) {
    if (n < def.min || n > def.max) {
      const need = def.min === def.max ? `${def.min}개` : `${def.min}~${def.max}개`
      this.err(line, `${label ?? name}() 에는 값이 ${need} 필요한데 ${n}개를 넣었어요.`)
    }
  }

  trace(name: string, pin: number | null, line: number) {
    const ctx = this.ctx
    const key = `${name}|${pin}|${ctx.phase}|${line}`
    const t = ctx.trace.calls.get(key)
    if (t) t.count++
    else ctx.trace.calls.set(key, { name, pin, line, phase: ctx.phase, count: 1 })
  }

  call(e: Extract<Expr, { k: 'call' }>, asStmt: boolean): CE {
    const ctx = this.ctx
    const line = e.line
    const callee = e.callee
    const self = this

    // ── 멤버 호출: Serial.x(), dht.x(), str.x() ──
    if (callee.k === 'member') {
      const obj = callee.obj
      const prop = callee.prop
      if (obj.k === 'ident' && obj.name === 'Serial') {
        const def = SERIAL_METHODS[prop]
        if (!def) {
          const near = suggest(prop, Object.keys(SERIAL_METHODS))
          this.err(line, `Serial.${prop}() 는 없는 함수예요.${near ? ` 혹시 Serial.${near} 인가요?` : ''}`)
        }
        this.arity(prop, def, e.args.length, line, `Serial.${prop}`)
        this.recordCall(`Serial.${prop}`, line)
        return this.serialCall(prop, e.args.map((a) => this.expr(a)), line)
      }
      if (obj.k === 'ident' && (obj.name === 'serial')) this.err(line, 'serial 이 아니라 대문자 Serial 로 써야 해요.')
      const o = this.expr(obj)
      if (o.ty === 'DHT11' || o.ty === 'DHT') {
        const table = o.ty === 'DHT11' ? DHT11_METHODS : DHT_METHODS
        const def = table[prop]
        if (!def) {
          const near = suggest(prop, Object.keys(table))
          this.err(line, `${o.ty} 에는 ${prop}() 함수가 없어요.${near ? ` 혹시 ${near} 인가요?` : ''}`)
        }
        this.arity(prop, def, e.args.length, line)
        this.recordCall(`${o.ty}.${prop}`, line)
        return this.dhtCall(o, prop, e.args, line)
      }
      if (o.ty === 'String' && !o.arr) {
        const def = STRING_METHODS[prop]
        if (!def) this.err(line, `String 에는 ${prop}() 함수가 없어요.`)
        this.arity(prop, def, e.args.length, line)
        const args = e.args.map((a) => this.expr(a))
        switch (prop) {
          case 'length': return this.mk('uint', [o], line, (s: string) => s.length)
          case 'toInt': return this.mk('long', [o], line, (s: string) => conv(parseInt(s, 10) || 0, 'long'))
          case 'toFloat': return this.mk('float', [o], line, (s: string) => Math.fround(parseFloat(s) || 0))
          case 'indexOf': { const at = args[0].ty; return this.mk('int', [o, args[0]], line, (s: string, x) => s.indexOf(formatValue(x, at))) }
          case 'substring': return this.mk('String', [o, ...args], line, (s: string, a: number, b?: number) => s.substring(a, b))
          case 'equals': return this.mk('bool', [o, args[0]], line, (s: string, x) => (s === String(x) ? 1 : 0))
          case 'charAt': return this.mk('char', [o, args[0]], line, (s: string, k: number) => s.charCodeAt(k) || 0)
          case 'trim': {
            const lv = this.lvalue(obj, line)
            return { ty: 'void', gen: false, line, fn: (f) => { lv.set(f, String(lv.get(f)).trim()) } }
          }
        }
      }
      this.err(line, `.${prop}() 를 쓸 수 없는 값이에요.`)
    }

    // ── DHT11::getErrorString ──
    if (callee.k === 'scoped') {
      if (callee.ns === 'DHT11' && callee.name === 'getErrorString') {
        if (e.args.length !== 1) this.err(line, 'DHT11::getErrorString() 에는 오류 번호 하나가 필요해요.')
        this.recordCall('DHT11::getErrorString', line)
        return this.mk('String', [this.expr(e.args[0])], line, (c: number) => DHT11_ERRORS[c] ?? 'Error Unknown.')
      }
      this.err(line, `${callee.ns}::${callee.name}() 는 지원하지 않아요.`)
    }

    if (callee.k !== 'ident') this.err(line, '이 값은 함수처럼 호출할 수 없어요.')
    const name = callee.name

    // ── 사용자 함수 ──
    const fn = this.funcs.get(name)
    if (fn && !this.lookup(name)) {
      this.recordCall(name, line)
      if (e.args.length !== fn.params.length) this.err(line, `${name}() 에는 값이 ${fn.params.length}개 필요한데 ${e.args.length}개를 넣었어요.`)
      if (name === 'setup' || name === 'loop') this.warnings.push({ line, message: `${name}() 는 아두이노가 알아서 부르니 직접 부르지 않아도 돼요.` })
      const argFns: (Pure | GenFn)[] = []
      const argGen: boolean[] = []
      const refs: ((f: Frame) => Ref)[] = []
      fn.params.forEach((p, i) => {
        if (p.isRef) {
          const lv = this.lvalue(e.args[i], line)
          if (lv.ty !== p.ty) this.err(line, `${name}() 의 ${i + 1}번째 값은 ${TYPE_KO[p.ty]} 변수여야 해요.`)
          refs[i] = (f) => ({ get: () => lv.get(f), set: (v) => lv.set(f, v) })
          argFns.push(() => 0)
          argGen.push(false)
        } else {
          const a = this.expr(e.args[i])
          if (p.isArray && !a.arr) this.err(line, `${name}() 의 ${i + 1}번째 값은 배열이어야 해요.`)
          if (!p.isArray) this.checkAssignable(p.ty, a, line)
          argFns.push(a.fn)
          argGen.push(a.gen)
        }
      })
      const params = fn.params
      const call: GenFn = function* (f) {
        const frame: Frame = new Array(fn.nLocals)
        for (let i = 0; i < params.length; i++) {
          const p = params[i]
          if (p.isRef) frame[i] = refs[i](f)
          else {
            const v = argGen[i] ? yield* (argFns[i] as GenFn)(f) : (argFns[i] as Pure)(f)
            frame[i] = p.isArray ? v : convAny(v, p.ty)
          }
        }
        if (++ctx.depth > 200) throw new RuntimeError(line, `함수 ${name}() 가 자기 자신을 너무 많이 불러요 (재귀가 끝나지 않아요).`)
        const savedLine = ctx.line
        ctx.retVal = 0
        const sig = yield* fn.body!(frame)
        ctx.depth--
        ctx.line = savedLine
        const r = sig === SIG_RETURN ? ctx.retVal : fn.ret === 'String' ? '' : 0
        return r
      }
      if (fn.ret === 'void' && !asStmt) {
        // 계산식 안의 void 호출은 binaryFn 등에서 막힌다
      }
      return { ty: fn.ret, gen: true, fn: call, line }
    }

    // ── 내장 함수 ──
    const def = BUILTINS[name]
    if (!def) {
      const near = suggest(name, [...Object.keys(BUILTINS), ...this.funcs.keys()])
      if (this.lookup(name)) this.err(line, `${name} 은(는) 변수라서 () 로 호출할 수 없어요.`)
      this.err(line, `함수 ${josa(name, '을를')} 찾을 수 없어요.${near ? ` 혹시 ${near} 인가요? (대소문자 구분)` : ''}`)
    }
    this.arity(name, def, e.args.length, line)
    this.recordCall(name, line)
    const args = e.args.map((a) => this.expr(a))
    for (const a of args) if (a.ty === 'void') this.err(line, `${name}() 에 값이 없는 함수 결과를 넣었어요.`)
    if (PIN_FNS.has(name)) {
      for (const a of args) if (isText(a.ty)) this.err(line, `${name}() 에 글자를 넣을 수 없어요. 핀 번호와 값은 숫자예요.`)
      if (args[0].constVal !== undefined && (args[0].constVal < 0 || args[0].constVal > 19)) this.err(line, `핀 번호 ${args[0].constVal} 는 UNO 에 없어요. (0~13, A0~A5)`)
      if (name === 'analogRead' && args[0].constVal !== undefined && args[0].constVal > 5 && args[0].constVal < 14) {
        this.warnings.push({ line, message: `analogRead(${args[0].constVal}) 는 아날로그 핀이 아니에요. A0~A5 를 쓰세요.` })
      }
      if (name === 'pinMode' && e.args[1].k === 'ident' && (e.args[1].name === 'HIGH' || e.args[1].name === 'LOW')) {
        this.err(line, 'pinMode 의 두 번째 값은 HIGH/LOW 가 아니라 INPUT, OUTPUT, INPUT_PULLUP 이에요.')
      }
      if (name === 'digitalWrite' && e.args[1].k === 'ident' && ['OUTPUT', 'INPUT', 'INPUT_PULLUP'].includes(e.args[1].name)) {
        this.err(line, 'digitalWrite 의 두 번째 값은 HIGH 또는 LOW 예요.')
      }
      if (name === 'analogWrite' && args[1].constVal !== undefined && (args[1].constVal > 255 || args[1].constVal < 0)) {
        this.warnings.push({ line, message: `analogWrite 값 ${args[1].constVal} 은(는) 범위를 넘어요. 0~255 만 가능해요.` })
      }
    }
    if (asStmt && def.ret !== 'void' && ['digitalRead', 'analogRead', 'millis', 'pulseIn', 'map'].includes(name)) {
      this.warnings.push({ line, message: `${name}() 의 결과를 변수에 저장하지 않았어요. 예: int value = ${name}(...);` })
    }
    const hw = () => ctx.hw
    switch (name) {
      case 'pinMode':
        return this.mk('void', args, line, (pin: number, mode: number) => {
          self.trace('pinMode', pin, line)
          if (mode < 0 || mode > 2) throw new RuntimeError(line, 'pinMode 의 두 번째 값은 INPUT, OUTPUT, INPUT_PULLUP 중 하나여야 해요.')
          ctx.trace.pinModes.set(pin, MODE_NAMES[mode])
          checkPin(pin, line)
          hw().pinMode(pin, MODE_NAMES[mode] as 'INPUT')
          ctx.time += 3
        })
      case 'digitalWrite':
        return this.mk('void', args, line, (pin: number, v: number) => { checkPin(pin, line); self.trace('digitalWrite', pin, line); hw().digitalWrite(pin, v); ctx.time += 5 })
      case 'digitalRead':
        return this.mk('int', args, line, (pin: number) => { checkPin(pin, line); self.trace('digitalRead', pin, line); ctx.time += 5; return hw().digitalRead(pin) })
      case 'analogRead':
        return this.mk('int', args, line, (pin: number) => { self.trace('analogRead', pin < 6 ? pin + 14 : pin, line); ctx.time += 112; return hw().analogRead(pin) })
      case 'analogWrite':
        return this.mk('void', args, line, (pin: number, v: number) => { checkPin(pin, line); self.trace('analogWrite', pin, line); hw().analogWrite(pin, v); ctx.time += 8 })
      case 'delay': {
        const a = args[0]
        if (a.constVal !== undefined && a.constVal < 0) this.err(line, 'delay 에 음수를 넣을 수 없어요.')
        const af = this.genOf(a)
        return {
          ty: 'void', gen: true, line,
          fn: function* (f) {
            const ms = Number(yield* af(f))
            if (ms > 0) ctx.time += conv(ms, 'ulong') * 1000
            yield
            return undefined
          },
        }
      }
      case 'delayMicroseconds':
        return this.mk('void', args, line, (us: number) => { ctx.time += Math.max(0, us & 0xffff) })
      case 'millis': return this.mk('ulong', [], line, () => Math.floor(ctx.time / 1000) >>> 0)
      case 'micros': return this.mk('ulong', [], line, () => Math.floor(ctx.time) >>> 0)
      case 'pulseIn':
        return this.mk('ulong', args, line, (pin: number, level: number, timeout?: number) => {
          checkPin(pin, line)
          self.trace('pulseIn', pin, line)
          const r = hw().pulseIn(pin, level ? 1 : 0, timeout ?? 1000000)
          ctx.time += r.waitedUs
          return r.value
        })
      case 'map':
        return this.mk('long', args, line, (x: number, a: number, b: number, c: number, d: number) => {
          if (b - a === 0) throw new RuntimeError(line, 'map() 의 입력 범위 최솟값과 최댓값이 같아요 (0으로 나누기).')
          const [X, A, B, C, D] = [x, a, b, c, d].map((v) => conv(v, 'long'))
          return conv(Math.trunc(((X - A) * (D - C)) / (B - A)) + C, 'long')
        })
      case 'constrain': {
        const ty = arithType(arithType(args[0].ty, args[1].ty), args[2].ty)
        return this.mk(ty, args, line, (x: number, a: number, b: number) => conv(x < a ? a : x > b ? b : x, ty))
      }
      case 'min': case 'max': {
        const ty = arithType(args[0].ty, args[1].ty)
        return this.mk(ty, args, line, name === 'min' ? (a: number, b: number) => conv(Math.min(a, b), ty) : (a: number, b: number) => conv(Math.max(a, b), ty))
      }
      case 'abs': { const ty = unaryType(args[0].ty); return this.mk(ty, args, line, (a: number) => conv(Math.abs(a), ty)) }
      case 'random':
        return this.mk('long', args, line, (a: number, b?: number) => {
          const [lo, hi] = b === undefined ? [0, a] : [a, b]
          if (hi <= lo) return lo
          ctx.rng = (Math.imul(ctx.rng, 1103515245) + 12345) >>> 0
          return lo + (ctx.rng % (hi - lo))
        })
      case 'randomSeed': return this.mk('void', args, line, (s: number) => { ctx.rng = s >>> 0 || 1 })
      case 'sqrt': return this.mk('float', args, line, (a: number) => Math.fround(Math.sqrt(a)))
      case 'pow': return this.mk('float', args, line, (a: number, b: number) => Math.fround(Math.pow(a, b)))
      case 'sin': return this.mk('float', args, line, (a: number) => Math.fround(Math.sin(a)))
      case 'cos': return this.mk('float', args, line, (a: number) => Math.fround(Math.cos(a)))
      case 'floor': return this.mk('float', args, line, (a: number) => Math.floor(a))
      case 'ceil': return this.mk('float', args, line, (a: number) => Math.ceil(a))
      case 'round': return this.mk('long', args, line, (a: number) => conv(a >= 0 ? Math.floor(a + 0.5) : Math.ceil(a - 0.5), 'long'))
      case 'isnan': return this.mk('bool', args, line, (a: number) => (Number.isNaN(a) ? 1 : 0))
      case 'tone': case 'noTone':
        this.warnings.push({ line, message: '이 시뮬레이터에는 부저가 없어서 tone() 은 소리가 나지 않아요.' })
        return this.mk('void', args, line, () => undefined)
    }
    this.err(line, `${name}() 는 지원하지 않아요.`)

    function checkPin(pin: number, l: number) {
      if (!(pin >= 0 && pin <= 19)) throw new RuntimeError(l, `핀 번호 ${pin} 는 UNO 에 없어요. (0~13, A0~A5)`)
    }
  }

  serialCall(prop: string, args: CE[], line: number): CE {
    const ctx = this.ctx
    const send = (text: string) => {
      // 9600 baud: 글자당 약 1.04ms. 64바이트 버퍼가 차면 기다린다.
      const per = 1042
      ctx.txFreeAt = Math.max(ctx.txFreeAt, ctx.time) + text.length * per
      if (ctx.txFreeAt - ctx.time > 64 * per) ctx.time = ctx.txFreeAt - 64 * per
      ctx.hw.serialWrite(text)
      return text.length
    }
    switch (prop) {
      case 'begin': return this.mk('void', args, line, () => { this.trace('Serial.begin', null, line); ctx.hw.serialBegin(9600) })
      case 'print':
      case 'println': {
        const nl = prop === 'println' ? '\r\n' : ''
        if (!args.length) return this.mk('ulong', [], line, () => send(nl))
        const a = args[0]
        if (a.arr && a.ty !== 'char') this.err(line, 'Serial.print 로 배열 전체를 출력할 수 없어요. 요소를 하나씩 출력하세요.')
        if (a.ty === 'DHT11' || a.ty === 'DHT') this.err(line, '센서 객체는 출력할 수 없어요. 읽은 값을 출력하세요.')
        const ty = a.ty
        const isCharArr = !!a.arr && a.ty === 'char'
        const self = this
        return this.mk('ulong', args, line, (v: unknown, fmt?: number) => {
          self.trace(`Serial.${prop}`, null, line)
          let text: string
          if (isCharArr) {
            const arr = v as number[]
            const end = arr.indexOf(0)
            text = String.fromCharCode(...arr.slice(0, end < 0 ? arr.length : end))
          } else text = formatValue(v, ty, fmt)
          return send(text + nl)
        })
      }
      case 'write': {
        const ty = args[0].ty
        return this.mk('ulong', args, line, (v: unknown) => send(isText(ty) ? String(v) : String.fromCharCode((v as number) & 0xff)))
      }
      case 'available': return this.mk('int', [], line, () => ctx.hw.serialAvailable())
      case 'read': return this.mk('int', [], line, () => ctx.hw.serialRead())
      case 'peek': return this.mk('int', [], line, () => (ctx.hw.serialAvailable() ? (ctx.hw as unknown as { serialIn: number[] }).serialIn[0] : -1))
      case 'parseInt': return this.mk('long', [], line, () => {
        let s = ''
        let c = ctx.hw.serialRead()
        while (c >= 0 && !/[-0-9]/.test(String.fromCharCode(c))) c = ctx.hw.serialRead()
        while (c >= 0 && /[-0-9]/.test(String.fromCharCode(c))) { s += String.fromCharCode(c); c = ctx.hw.serialRead() }
        return conv(parseInt(s, 10) || 0, 'long')
      })
      default: return this.mk('void', args, line, () => undefined)
    }
  }

  dhtCall(o: CE, prop: string, argEs: Expr[], line: number): CE {
    const ctx = this.ctx
    const self = this
    const objFn = this.pure(o)
    if (o.ty === 'DHT11') {
      type D = { pin: number; delayMs: number }
      const read = (d: D) => {
        self.trace('dht', d.pin, line)
        ctx.time += d.delayMs * 1000 + 20000
        return ctx.hw.dhtRead(d.pin)
      }
      switch (prop) {
        case 'readTemperatureHumidity': {
          const t = this.lvalue(argEs[0], line)
          const h = this.lvalue(argEs[1], line)
          if (!isInt(t.ty) && t.ty !== 'float') this.err(line, 'readTemperatureHumidity() 에는 숫자 변수 두 개를 넣어요. 예: (temperature, humidity)')
          const tt = t.ty, ht = h.ty
          return { ty: 'int', gen: false, line, fn: (f) => {
            const r = read(objFn(f) as D)
            if (!r.ok) return 253
            t.set(f, conv(r.temperature, tt))
            h.set(f, conv(r.humidity, ht))
            return 0
          } }
        }
        case 'readTemperature': return { ty: 'int', gen: false, line, fn: (f) => { const r = read(objFn(f) as D); return r.ok ? r.temperature : 253 } }
        case 'readHumidity': return { ty: 'int', gen: false, line, fn: (f) => { const r = read(objFn(f) as D); return r.ok ? r.humidity : 253 } }
        case 'setDelay': {
          const a = this.pure(this.expr(argEs[0]))
          return { ty: 'void', gen: false, line, fn: (f) => { (objFn(f) as D).delayMs = Number(a(f)) } }
        }
      }
    }
    type A = { pin: number; begun: boolean; last: number; t: number; h: number }
    const sample = (d: A) => {
      self.trace('dht', d.pin, line)
      if (!d.begun) ctx.hw.warn('dhtbegin', 'DHT.h 방식은 setup 에서 dht.begin() 을 먼저 호출해야 해요.')
      if (ctx.time - d.last >= 2_000_000) {
        d.last = ctx.time
        ctx.time += 25000
        const r = ctx.hw.dhtRead(d.pin)
        d.t = r.ok && d.begun ? r.temperature : NaN
        d.h = r.ok && d.begun ? r.humidity : NaN
      }
    }
    const args = argEs.map((a) => this.expr(a))
    switch (prop) {
      case 'begin': return { ty: 'void', gen: false, line, fn: (f) => { (objFn(f) as A).begun = true } }
      case 'readTemperature': {
        const fArg = args[0] ? this.pure(args[0]) : null
        return { ty: 'float', gen: false, line, fn: (f) => { const d = objFn(f) as A; sample(d); return fArg && fArg(f) ? Math.fround(d.t * 1.8 + 32) : d.t } }
      }
      case 'readHumidity': return { ty: 'float', gen: false, line, fn: (f) => { const d = objFn(f) as A; sample(d); return d.h } }
      case 'computeHeatIndex': return this.mk('float', args, line, (t: number) => t)
    }
    this.err(line, `${prop}() 는 지원하지 않아요.`)
  }

  // ── 실행기 ──
  makeRunner(hw: Hardware): Runner {
    const ctx = this.ctx
    ctx.hw = hw
    // 전역 변수 접근 함수들이 컴파일 때 ctx.G 배열을 캡처했으므로 같은 배열을 크기만 맞춰 쓴다
    const G = ctx.G
    G.length = this.nGlobals
    G.fill(0)
    const inits = this.globalInits
    const setup = this.funcs.get('setup')!
    const loop = this.funcs.get('loop')!
    const main = function* (): Generator<undefined, void, undefined> {
      ctx.phase = 'setup'
      for (const s of inits) yield* s([])
      ctx.retVal = 0
      yield* setup.body!(new Array(setup.nLocals))
      ctx.phase = 'loop'
      for (;;) {
        yield* loop.body!(new Array(loop.nLocals))
        ctx.loops++
        ctx.time += 4
        ctx.steps++
        yield
      }
    }
    const gen = main()
    const runner: Runner = {
      ctx,
      error: null,
      run(untilUs: number, maxSteps = Infinity) {
        if (runner.error) return 'error'
        const stepLimit = ctx.steps + maxSteps
        try {
          while (ctx.time < untilUs && ctx.steps < stepLimit) {
            const r = gen.next()
            if (r.done) return 'done'
          }
        } catch (e) {
          if (e instanceof RuntimeError) { runner.error = e; return 'error' }
          if (e instanceof StopSignal) return 'done'
          if (e instanceof RangeError) { runner.error = new RuntimeError(ctx.line, '함수 호출이 너무 깊어요 (재귀가 끝나지 않아요).'); return 'error' }
          throw e
        }
        return 'running'
      },
      stop() { ctx.stopped = true },
    }
    return runner
  }
}

interface Ref { get(): unknown; set(v: unknown): void }
