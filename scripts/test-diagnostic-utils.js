#!/usr/bin/env node

const assert = require("assert");
const {
  codePointColumnToUtf16,
  resolvePointerRange,
  sourceLineMatches,
} = require("../diagnostic-utils");

assert.strictEqual(codePointColumnToUtf16("abc", 2), 2);
assert.strictEqual(codePointColumnToUtf16("😀@", 1), 2);
assert.strictEqual(codePointColumnToUtf16("😀@", 2), 3);

assert.strictEqual(sourceLineMatches("acha x = 1 @ 2   ", "acha x = 1 @ 2"), true);
assert.strictEqual(sourceLineMatches("ikiwa (x) {", "ikiwa x BASI"), false);

assert.deepStrictEqual(
  resolvePointerRange("ikiwa (nchi == 'kenya){", "ikiwa (nchi == 'kenya){", "               ^"),
  { start: 15, end: 16, sourceMatches: true },
);

assert.deepStrictEqual(
  resolvePointerRange("acha x = '😀' @", "acha x = '😀' @", "             ^"),
  { start: 14, end: 15, sourceMatches: true },
);

assert.deepStrictEqual(
  resolvePointerRange("acha x = 1 @ 2   ", "acha x = 1 @ 2", "           ^"),
  { start: 11, end: 12, sourceMatches: true },
);

assert.deepStrictEqual(
  resolvePointerRange("ikiwa (x) {", "ikiwa x BASI", "      ^"),
  { start: 0, end: 11, sourceMatches: false },
);

assert.deepStrictEqual(
  resolvePointerRange("andika('x')", "andika('x')", "            ^"),
  { start: 10, end: 11, sourceMatches: true },
);

console.log("diagnostic range tests passed");
