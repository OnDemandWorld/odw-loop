/**
 * Regression tests for the BranchNode condition evaluator (S5).
 *
 * The evaluator previously compiled condition strings with `new Function`,
 * letting a workflow author execute arbitrary JavaScript in the API process.
 * It now uses a restricted parser: comparisons, &&/||/! and literals only.
 */

import { describe, it, expect, vi } from 'vitest';
import { BranchNode, LoopNode } from '../../../packages/engine/src/nodes/index';

vi.mock('@loop/observability', () => ({
  createLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

describe('BranchNode — restricted condition evaluator (S5)', () => {
  const branches = (condition: string) => [{ id: 'yes', condition }];

  it('evaluates numeric comparisons against interpolated values', () => {
    expect(BranchNode.evaluate(branches('{{ctx.count}} > 5'), { ctx: { count: 7 } })).toBe('yes');
    expect(BranchNode.evaluate(branches('{{ctx.count}} > 5'), { ctx: { count: 3 } })).toBeNull();
    expect(BranchNode.evaluate(branches('{{ctx.count}} <= 5'), { ctx: { count: 3 } })).toBe('yes');
  });

  it('evaluates string equality', () => {
    expect(BranchNode.evaluate(branches('{{ctx.status}} == "active"'), { ctx: { status: 'active' } })).toBe('yes');
    expect(BranchNode.evaluate(branches('{{ctx.status}} != "active"'), { ctx: { status: 'paused' } })).toBe('yes');
  });

  it('supports && / || / ! and parentheses', () => {
    expect(BranchNode.evaluate(branches('{{ctx.a}} > 1 && {{ctx.b}} < 2'), { ctx: { a: 2, b: 1 } })).toBe('yes');
    expect(BranchNode.evaluate(branches('{{ctx.a}} > 1 || {{ctx.b}} < 2'), { ctx: { a: 0, b: 1 } })).toBe('yes');
    expect(BranchNode.evaluate(branches('{{ctx.a}} > 1 || {{ctx.b}} < 2'), { ctx: { a: 0, b: 9 } })).toBeNull();
    expect(BranchNode.evaluate(branches('!{{ctx.flag}}'), { ctx: { flag: false } })).toBe('yes');
    expect(BranchNode.evaluate(branches('({{ctx.a}} == 1 || {{ctx.b}} == 2) && {{ctx.c}}'), { ctx: { a: 1, b: 0, c: true } })).toBe('yes');
  });

  it('evaluates bare booleans and literals', () => {
    expect(BranchNode.evaluate(branches('true'), {})).toBe('yes');
    expect(BranchNode.evaluate(branches('false'), {})).toBeNull();
  });

  it('does NOT execute JavaScript — injections fail closed to false', () => {
    const malicious = 'process.exit(1)';
    expect(BranchNode.evaluate(branches(malicious), {})).toBeNull();

    const exfiltration = 'globalThis.require("node:child_process")';
    expect(BranchNode.evaluate(branches(exfiltration), {})).toBeNull();

    const constructor = '{{ctx.x}}.constructor("return 1")()';
    expect(BranchNode.evaluate(branches(constructor), { ctx: { x: 1 } })).toBeNull();
  });

  it('fails closed on malformed conditions', () => {
    expect(BranchNode.evaluate(branches('{{ctx.a}} >'), { ctx: { a: 1 } })).toBeNull();
    expect(BranchNode.evaluate(branches('(true'), {})).toBeNull();
    expect(BranchNode.evaluate(branches('"unterminated'), {})).toBeNull();
  });
});

describe('LoopNode', () => {
  it('continues only while the condition holds and stops at max iterations', () => {
    expect(LoopNode.shouldContinue('{{i}} < 3', { i: 1 }, 0)).toBe(true);
    expect(LoopNode.shouldContinue('{{i}} < 3', { i: 5 }, 0)).toBe(false);
    // An unresolved reference must NOT satisfy the comparison.
    expect(LoopNode.shouldContinue('{{missing}} < 3', {}, 0)).toBe(false);
    expect(LoopNode.shouldContinue('true', {}, 1000)).toBe(false);
  });
});

describe('BranchNode — escaped string literals (audit #46)', () => {
  const branches = (condition: string) => [{ id: 'yes', condition }];

  it('equal values containing double quotes compare true (JSON-escaped interpolation)', () => {
    const ctx = { ctx: { name: 'O"Brien', expected: 'O"Brien' } };
    expect(BranchNode.evaluate(branches('{{ctx.name}} == {{ctx.expected}}'), ctx)).toBe('yes');
  });

  it('different quoted values still compare false', () => {
    const ctx = { ctx: { name: 'O"Brien', expected: 'O"Connor' } };
    expect(BranchNode.evaluate(branches('{{ctx.name}} == {{ctx.expected}}'), ctx)).toBeNull();
  });

  it('values with backslashes and newlines round-trip through interpolation', () => {
    const ctx = { ctx: { a: 'back\\slash', b: 'back\\slash', multi: 'line1\nline2' } };
    expect(BranchNode.evaluate(branches('{{ctx.a}} == {{ctx.b}}'), ctx)).toBe('yes');
    expect(BranchNode.evaluate(branches('{{ctx.multi}} == "line1\nline2"'), ctx)).toBe('yes');
  });
});
