/**
 * Example test file demonstrating the test pattern for Scout
 * This file verifies the testing infrastructure is working correctly.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('Testing Infrastructure', () => {
  it('should pass a basic assertion', () => {
    assert.strictEqual(1 + 1, 2);
  });

  it('should handle async tests', async () => {
    const result = await Promise.resolve('hello');
    assert.strictEqual(result, 'hello');
  });

  it('should support object assertions', () => {
    const obj = { name: 'Scout', version: '0.0.0' };
    assert.deepStrictEqual(obj, { name: 'Scout', version: '0.0.0' });
  });
});
