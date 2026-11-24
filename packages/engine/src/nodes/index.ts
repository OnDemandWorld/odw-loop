/**
 * Control flow node handlers — branch, loop, parallel, approval, delay (§6.1, §6.6).
 */

import { createLogger } from '@loop/observability';

const logger = createLogger({ name: 'loop:engine:nodes', component: 'engine' });

// ─── Branch ───────────────────────────────────────────────────────────────────

/**
 * Tokens for the restricted condition language. Only the constructs below are
 * recognised — anything else makes evaluation fail closed (false). Conditions
 * in workflow definitions previously went through `new Function`, which let a
 * workflow author execute arbitrary JavaScript inside the API process (RCE).
 */
type Token =
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'ident'; value: string }
  | { kind: 'op'; value: string };

const OPERATORS = [
  '===', '!==', '==', '!=', '>=', '<=', '&&', '||',
  '>', '<', '!', '(', ')',
] as const;

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }
    // String literal ('…' or "…"). Audit #46: honour backslash escapes —
    // interpolated values arrive JSON-stringified (embedded quotes as \"),
    // and the old indexOf scanner terminated the literal at the escaped
    // quote, failing the parse closed to false even for equal values.
    if (ch === '\'' || ch === '"') {
      let j = i + 1;
      while (j < input.length) {
        if (input[j] === '\\') {
          j += 2;
          continue;
        }
        if (input[j] === ch) break;
        j++;
      }
      if (j >= input.length) throw new Error('unterminated string literal');
      const raw = input.slice(i, j + 1);
      let value: string;
      if (ch === '"') {
        // Double-quoted literals use JSON string syntax (interpolation emits
        // JSON.stringify); fall back to the raw text for hand-written literals
        // with non-JSON escapes.
        try {
          value = JSON.parse(raw) as string;
        } catch {
          value = input.slice(i + 1, j);
        }
      } else {
        value = input.slice(i + 1, j);
      }
      tokens.push({ kind: 'string', value });
      i = j + 1;
      continue;
    }
    // Number literal.
    if (/[0-9]/.test(ch) || (ch === '-' && /[0-9]/.test(input[i + 1] ?? ''))) {
      const match = /^-?[0-9]+(\.[0-9]+)?/.exec(input.slice(i))!;
      tokens.push({ kind: 'number', value: Number(match[0]) });
      i += match[0].length;
      continue;
    }
    // Identifier / keyword (true, false, null, or a bare reference).
    if (/[A-Za-z_]/.test(ch)) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(input.slice(i))!;
      tokens.push({ kind: 'ident', value: match[0] });
      i += match[0].length;
      continue;
    }
    // Operator / paren.
    const op = OPERATORS.find((o) => input.startsWith(o, i));
    if (op === undefined) throw new Error(`unexpected character '${ch}'`);
    tokens.push({ kind: 'op', value: op });
    i += op.length;
  }
  return tokens;
}

/** Truthiness of a evaluated condition value (JS semantics for scalars). */
function isTruthy(value: ConditionValue): boolean {
  return value !== null && value !== undefined && value !== false && value !== 0 && value !== '';
}

type ConditionValue = string | number | boolean | null | undefined;

/** Equality across scalars — strict when types match, string-compared otherwise. */
function looseEquals(a: ConditionValue, b: ConditionValue): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  if (typeof a === typeof b) return false;
  return String(a) === String(b);
}

/** Numeric ordering for scalar comparisons (string-compared when mixed). */
function compareOrder(a: ConditionValue, b: ConditionValue): number {
  // Unresolved references (null/undefined) must never satisfy a comparison —
  // fail with NaN so every relational operator returns false.
  if (a === null || a === undefined || b === null || b === undefined) return Number.NaN;
  const na = typeof a === 'number' ? a : Number(a);
  const nb = typeof b === 'number' ? b : Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/**
 * Recursive-descent evaluator for the restricted grammar:
 *   or      := and ( '||' and )*
 *   and     := cmp ( '&&' cmp )*
 *   cmp     := unary ( ('=='|'!='|'==='|'!=='|'>'|'<'|'>='|'<=') unary )?
 *   unary   := '!' unary | '(' or ')' | literal
 *   literal := number | string | 'true' | 'false' | 'null'
 */
class ConditionParser {
  private pos = 0;

  constructor(private tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private eatOp(value: string): boolean {
    const t = this.peek();
    if (t && t.kind === 'op' && t.value === value) {
      this.pos++;
      return true;
    }
    return false;
  }

  parse(): ConditionValue {
    const value = this.parseOr();
    if (this.pos !== this.tokens.length) throw new Error('trailing tokens in condition');
    return value;
  }

  private parseOr(): ConditionValue {
    let left = this.parseAnd();
    while (this.eatOp('||')) {
      const right = this.parseAnd();
      left = isTruthy(left) || isTruthy(right);
    }
    return left;
  }

  private parseAnd(): ConditionValue {
    let left = this.parseCmp();
    while (this.eatOp('&&')) {
      const right = this.parseCmp();
      left = isTruthy(left) && isTruthy(right);
    }
    return left;
  }

  private parseCmp(): ConditionValue {
    const left = this.parseUnary();
    const t = this.peek();
    if (t && t.kind === 'op' && ['==', '!=', '===', '!==', '>', '<', '>=', '<='].includes(t.value)) {
      this.pos++;
      const right = this.parseUnary();
      switch (t.value) {
        case '==':
        case '===':
          return looseEquals(left, right);
        case '!=':
        case '!==':
          return !looseEquals(left, right);
        case '>': return compareOrder(left, right) > 0;
        case '<': return compareOrder(left, right) < 0;
        case '>=': return compareOrder(left, right) >= 0;
        case '<=': return compareOrder(left, right) <= 0;
      }
    }
    return left;
  }

  private parseUnary(): ConditionValue {
    if (this.eatOp('!')) {
      return !isTruthy(this.parseUnary());
    }
    return this.parsePrimary();
  }

  private parsePrimary(): ConditionValue {
    const t = this.peek();
    if (t === undefined) throw new Error('unexpected end of condition');
    if (t.kind === 'op' && t.value === '(') {
      this.pos++;
      const value = this.parseOr();
      if (!this.eatOp(')')) throw new Error('missing closing parenthesis');
      return value;
    }
    this.pos++;
    if (t.kind === 'number') return t.value;
    if (t.kind === 'string') return t.value;
    if (t.kind === 'ident') {
      if (t.value === 'true') return true;
      if (t.value === 'false') return false;
      if (t.value === 'null') return null;
      // Bare references (post-interpolation leftovers) are unknown → falsy.
      return undefined;
    }
    throw new Error(`unexpected token '${t.value}'`);
  }
}

export class BranchNode {
  /**
   * V1.7 (branch wiring): public entry for the executor. Evaluates a single
   * `control.branch` condition against an execution context
   * (`trigger.payload.*`, `variables.*`, `<nodeId>.output.*`) and reports
   * which port fired.
   */
  static evaluateBranch(condition: string, context: Record<string, unknown>): boolean {
    return this.evalCondition(condition, context);
  }

  /** Evaluate a branch condition and return the selected branch ID. */
  static evaluate(conditions: Array<{ id: string; condition: string }>, context: Record<string, unknown>): string | null {
    for (const branch of conditions) {
      if (this.evalCondition(branch.condition, context)) {
        return branch.id;
      }
    }
    return null;
  }

  private static evalCondition(condition: string, context: Record<string, unknown>): boolean {
    // Restricted expression evaluator — NO `new Function`/eval. Interpolated
    // `{{reference}}` values are JSON-encoded (so strings stay quoted, numbers
    // stay numeric) and only comparison/logic operators are recognised. Any
    // parse failure fails closed (false), as before.
    try {
      const expr = condition.replace(/\{\{([^}]+)\}\}/g, (_match, path: string) => {
        const value = path.split('.').reduce((obj: unknown, key: string) => {
          if (obj && typeof obj === 'object') return (obj as Record<string, unknown>)[key];
          return undefined;
        }, context);
        // JSON.stringify(undefined) is undefined — emit the bare word so the
        // parser treats it as an unknown (falsy) reference.
        const serialized = JSON.stringify(value) ?? 'undefined';
        return serialized;
      });
      const value = new ConditionParser(tokenize(expr)).parse();
      return isTruthy(value);
    } catch (err) {
      logger.debug({ condition, error: String(err) }, 'Condition evaluation failed — treating as false');
      return false;
    }
  }
}

// ─── Loop ─────────────────────────────────────────────────────────────────────

export class LoopNode {
  /** Check if a loop should continue iterating. */
  static shouldContinue(condition: string, context: Record<string, unknown>, iteration: number, maxIterations = 1000): boolean {
    if (iteration >= maxIterations) {
      logger.warn({ iteration, maxIterations }, 'Loop hit max iterations');
      return false;
    }
    return BranchNode.evaluate([{ id: 'continue', condition }], context) === 'continue';
  }
}

// ─── Parallel ─────────────────────────────────────────────────────────────────

export class ParallelNode {
  /** Execute multiple branches in parallel and wait for all to complete. */
  static async executeAll<T>(fns: Array<() => Promise<T>>): Promise<T[]> {
    return Promise.all(fns.map((fn) => fn()));
  }
}

// ─── Approval ─────────────────────────────────────────────────────────────────

export class ApprovalNode {
  /** Pause execution for human approval (returns a waitpoint token). */
  static createWaitpoint(executionId: string, nodeId: string): string {
    return `approval:${executionId}:${nodeId}`;
  }
}

// ─── Delay ────────────────────────────────────────────────────────────────────

export class DelayNode {
  /** Pause execution for a specified duration. Audit #120: abortable — the
   *  timer is cleared when the node/workflow deadline aborts, so a long delay
   *  cannot outlive the failed execution and keep the event loop alive. */
  static async delay(durationMs: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('Delay aborted'));
        return;
      }
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(new Error('Delay aborted'));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, durationMs);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}
