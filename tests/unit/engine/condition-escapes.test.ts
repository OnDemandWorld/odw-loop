/**
 * Regression — condition string-literal escape handling (deep-review fix).
 *
 * Interpolated `{{reference}}` values are JSON.stringify'd before evaluation,
 * so a value containing a quote, backslash or newline arrives escaped
 * (e.g. `"a\"b"`, `"C:\\temp"`, `"x\ny"`). The previous indexOf(closeQuote)
 * scan truncated at the first inner quote and failed the whole condition
 * closed. The tokenizer now decodes JSON escapes (incl. \uXXXX) so such
 * values round-trip, and still fails closed on malformed literals.
 */

import { describe, it, expect } from 'vitest';
import { BranchNode } from '../../../packages/engine/src/nodes/index';

describe('BranchNode condition string escapes', () => {
  it('decodes an escaped double quote inside a literal', () => {
    expect(BranchNode.evaluateBranch('"a\\"b" == "a\\"b"', {})).toBe(true);
  });

  it('decodes newline / tab escapes', () => {
    expect(BranchNode.evaluateBranch('"x\\ny" == "x\\ny"', {})).toBe(true);
    expect(BranchNode.evaluateBranch('"a\\tb" == "a\\tb"', {})).toBe(true);
  });

  it('decodes a \\uXXXX unicode escape', () => {
    expect(BranchNode.evaluateBranch('"\\u0041" == "A"', {})).toBe(true);
  });

  it('decodes an escaped backslash (Windows path)', () => {
    expect(BranchNode.evaluateBranch('"C:\\\\temp" == "C:\\\\temp"', {})).toBe(true);
  });

  it('decodes an escaped single quote inside a single-quoted literal', () => {
    expect(BranchNode.evaluateBranch("'it\\'s' == 'it\\'s'", {})).toBe(true);
  });

  it('round-trips an interpolated value containing quotes and a newline', () => {
    const context = { trigger: { payload: { msg: 'he said "hi"\nbye' } } };
    expect(BranchNode.evaluateBranch('{{trigger.payload.msg}} != ""', context)).toBe(true);
  });

  it('round-trips an interpolated value containing backslashes', () => {
    const context = { trigger: { payload: { p: 'C:\\temp\\file' } } };
    expect(BranchNode.evaluateBranch('{{trigger.payload.p}} != ""', context)).toBe(true);
  });

  it('fails closed on an unterminated string literal', () => {
    expect(BranchNode.evaluateBranch('"unterminated == ""', {})).toBe(false);
  });

  it('fails closed on an invalid escape sequence', () => {
    expect(BranchNode.evaluateBranch('"bad\\q" == "x"', {})).toBe(false);
  });

  it('fails closed on an invalid unicode escape', () => {
    expect(BranchNode.evaluateBranch('"\\u00ZZ" == "A"', {})).toBe(false);
  });
});