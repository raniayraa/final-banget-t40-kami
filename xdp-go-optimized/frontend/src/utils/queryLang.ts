// queryLang.ts — Palo Alto Panorama-inspired query language for traffic log filtering.
//
// Supported syntax:
//   addr.src eq 1.2.3.4
//   addr.src in 192.168.0.0/24
//   port.dst eq 443
//   port.src gt 1024
//   proto eq tcp
//   action eq drop
//   addr.src eq 1.2.3.4 and port.dst eq 443
//   (addr.src eq 1.2.3.4 or addr.dst eq 1.2.3.4) and action eq drop
//   not action eq pass

import type { TrafficLog } from '../api/client'

// ─── Types ───────────────────────────────────────────────────────────────────

type FieldName = 'addr.src' | 'addr.dst' | 'port.src' | 'port.dst' | 'proto' | 'action'
type Operator  = 'eq' | 'neq' | 'in' | 'gt' | 'lt' | 'geq' | 'leq'

type ASTNode =
  | { kind: 'compare'; field: FieldName; op: Operator; value: string }
  | { kind: 'logical'; op: 'and' | 'or'; left: ASTNode; right: ASTNode }
  | { kind: 'not'; operand: ASTNode }

export type ParseResult =
  | { ok: true; ast: ASTNode | null }
  | { ok: false; error: string }

// ─── Tokenizer ───────────────────────────────────────────────────────────────

type TokenKind = 'FIELD' | 'OP' | 'AND' | 'OR' | 'NOT' | 'LPAREN' | 'RPAREN' | 'VALUE' | 'EOF'

interface Token {
  kind: TokenKind
  value: string
  pos: number
}

const FIELDS = new Set<string>(['addr.src', 'addr.dst', 'port.src', 'port.dst', 'proto', 'action'])
const OPS    = new Set<string>(['eq', 'neq', 'in', 'gt', 'lt', 'geq', 'leq'])

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0

  while (i < input.length) {
    // Skip whitespace
    if (/\s/.test(input[i])) { i++; continue }

    // Single-char tokens
    if (input[i] === '(') { tokens.push({ kind: 'LPAREN', value: '(', pos: i }); i++; continue }
    if (input[i] === ')') { tokens.push({ kind: 'RPAREN', value: ')', pos: i }); i++; continue }

    // Collect lexeme (non-whitespace, non-paren)
    const start = i
    while (i < input.length && !/[\s()]/.test(input[i])) i++
    const lexeme = input.slice(start, i)
    const lower  = lexeme.toLowerCase()

    let kind: TokenKind
    if (FIELDS.has(lower))    kind = 'FIELD'
    else if (OPS.has(lower))  kind = 'OP'
    else if (lower === 'and') kind = 'AND'
    else if (lower === 'or')  kind = 'OR'
    else if (lower === 'not') kind = 'NOT'
    else                      kind = 'VALUE'

    tokens.push({ kind, value: lexeme, pos: start })
  }

  tokens.push({ kind: 'EOF', value: '', pos: i })
  return tokens
}

// ─── Parser ──────────────────────────────────────────────────────────────────

class ParseError extends Error {}

function validateFieldOp(field: FieldName, op: Operator, pos: number): void {
  const isAddr = field === 'addr.src' || field === 'addr.dst'
  const isPort = field === 'port.src' || field === 'port.dst'

  if (op === 'in' && !isAddr) {
    throw new ParseError(`operator 'in' is only valid for addr fields (pos ${pos})`)
  }
  if ((op === 'gt' || op === 'lt' || op === 'geq' || op === 'leq') && !isPort) {
    throw new ParseError(`operator '${op}' is only valid for port fields (pos ${pos})`)
  }
}

class Parser {
  private tokens: Token[]
  private pos = 0

  constructor(tokens: Token[]) {
    this.tokens = tokens
  }

  private peek(): Token { return this.tokens[this.pos] }

  private consume(): Token { return this.tokens[this.pos++] }

  private expect(kind: TokenKind): Token {
    const t = this.peek()
    if (t.kind !== kind) {
      throw new ParseError(`expected '${kind}', got '${t.value || 'EOF'}' (pos ${t.pos})`)
    }
    return this.consume()
  }

  parseQuery(): ASTNode {
    const node = this.parseOr()
    const next = this.peek()
    if (next.kind !== 'EOF') {
      throw new ParseError(`unexpected token '${next.value}' after expression (pos ${next.pos})`)
    }
    return node
  }

  private parseOr(): ASTNode {
    let left = this.parseAnd()
    while (this.peek().kind === 'OR') {
      this.consume()
      const right = this.parseAnd()
      left = { kind: 'logical', op: 'or', left, right }
    }
    return left
  }

  private parseAnd(): ASTNode {
    let left = this.parseNot()
    while (this.peek().kind === 'AND') {
      this.consume()
      const right = this.parseNot()
      left = { kind: 'logical', op: 'and', left, right }
    }
    return left
  }

  private parseNot(): ASTNode {
    if (this.peek().kind === 'NOT') {
      this.consume()
      const operand = this.parseNot()
      return { kind: 'not', operand }
    }
    return this.parseAtom()
  }

  private parseAtom(): ASTNode {
    if (this.peek().kind === 'LPAREN') {
      this.consume()
      const node = this.parseOr()
      this.expect('RPAREN')
      return node
    }

    const fieldTok = this.peek()
    if (fieldTok.kind !== 'FIELD') {
      throw new ParseError(`expected field name (e.g. addr.src, port.dst), got '${fieldTok.value || 'EOF'}' (pos ${fieldTok.pos})`)
    }
    this.consume()

    const opTok = this.peek()
    if (opTok.kind !== 'OP') {
      throw new ParseError(`expected operator (eq, neq, in, gt, lt, geq, leq), got '${opTok.value || 'EOF'}' (pos ${opTok.pos})`)
    }
    this.consume()

    const valTok = this.peek()
    if (valTok.kind !== 'VALUE') {
      throw new ParseError(`expected a value, got '${valTok.value || 'EOF'}' (pos ${valTok.pos})`)
    }
    this.consume()

    const field = fieldTok.value.toLowerCase() as FieldName
    const op    = opTok.value.toLowerCase() as Operator
    validateFieldOp(field, op, opTok.pos)

    return { kind: 'compare', field, op, value: valTok.value }
  }
}

// ─── Exported parse entry point ───────────────────────────────────────────────

export function parseQuery(input: string): ParseResult {
  if (input.trim() === '') return { ok: true, ast: null }
  try {
    const tokens = tokenize(input)
    const parser = new Parser(tokens)
    const ast    = parser.parseQuery()
    return { ok: true, ast }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// ─── CIDR matching ───────────────────────────────────────────────────────────

function ipToUint32(ip: string): number {
  const parts = ip.split('.').map(Number)
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
}

function cidrContains(cidr: string, ip: string): boolean {
  const slash = cidr.indexOf('/')
  if (slash === -1) return ip === cidr
  const prefix = parseInt(cidr.slice(slash + 1), 10)
  if (isNaN(prefix) || prefix < 0 || prefix > 32) return false
  const mask    = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0
  const network = ipToUint32(cidr.slice(0, slash)) & mask
  const target  = ipToUint32(ip) & mask
  return network === target
}

// ─── Evaluator ───────────────────────────────────────────────────────────────

const PROTO_ALIASES: Record<string, number> = { icmp: 1, tcp: 6, udp: 17 }
const ACTION_ALIASES: Record<string, number> = {
  drop: 0, pass: 1, tx: 2, redirect: 3, ttl_exceeded: 4, ttl_exc: 4,
}

function resolveField(field: FieldName, log: TrafficLog): string | number {
  switch (field) {
    case 'addr.src': return log.src_ip
    case 'addr.dst': return log.dst_ip
    case 'port.src': return log.src_port
    case 'port.dst': return log.dst_port
    case 'proto':    return log.protocol
    case 'action':   return log.action
  }
}

function resolveValue(field: FieldName, raw: string): string | number {
  const lower = raw.toLowerCase()
  if (field === 'addr.src' || field === 'addr.dst') return raw
  if (field === 'proto') {
    if (lower in PROTO_ALIASES) return PROTO_ALIASES[lower]
    return parseInt(raw, 10)
  }
  if (field === 'action') {
    if (lower in ACTION_ALIASES) return ACTION_ALIASES[lower]
    return parseInt(raw, 10)
  }
  // port fields
  return parseInt(raw, 10)
}

export function evaluateQuery(ast: ASTNode, log: TrafficLog): boolean {
  switch (ast.kind) {
    case 'not':
      return !evaluateQuery(ast.operand, log)

    case 'logical':
      if (ast.op === 'and') return evaluateQuery(ast.left, log) && evaluateQuery(ast.right, log)
      return evaluateQuery(ast.left, log) || evaluateQuery(ast.right, log)

    case 'compare': {
      const logVal = resolveField(ast.field, log)
      const qVal   = resolveValue(ast.field, ast.value)

      if (ast.op === 'in') {
        return cidrContains(ast.value, logVal as string)
      }
      if (ast.op === 'eq')  return logVal === qVal
      if (ast.op === 'neq') return logVal !== qVal
      if (ast.op === 'gt')  return (logVal as number) >  (qVal as number)
      if (ast.op === 'lt')  return (logVal as number) <  (qVal as number)
      if (ast.op === 'geq') return (logVal as number) >= (qVal as number)
      if (ast.op === 'leq') return (logVal as number) <= (qVal as number)
      return false
    }
  }
}
