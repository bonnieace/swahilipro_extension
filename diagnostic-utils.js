function codePointColumnToUtf16(text, codePointColumn) {
  let seen = 0;
  let utf16Column = 0;

  for (const character of text) {
    if (seen >= codePointColumn) break;
    utf16Column += character.length;
    seen += 1;
  }

  return utf16Column;
}

function sourceLineMatches(documentLine, compilerSourceLine) {
  if (!compilerSourceLine) return true;
  if (compilerSourceLine === documentLine) return true;

  // The compiler historically removed trailing whitespace while translating
  // legacy syntax. Trailing whitespace does not change the causal column.
  return compilerSourceLine === documentLine.trimEnd();
}

function resolvePointerRange(documentLine, compilerSourceLine, pointerLine) {
  const pointerStart = pointerLine.indexOf("^");
  const matches = sourceLineMatches(documentLine, compilerSourceLine);

  if (!matches || pointerStart < 0) {
    const firstNonWhitespace = documentLine.search(/\S/);
    const start = firstNonWhitespace >= 0 ? firstNonWhitespace : 0;
    const end = documentLine.length > start ? documentLine.length : start;
    return { start, end, sourceMatches: matches };
  }

  const carets = (pointerLine.slice(pointerStart).match(/^\^+/) || [""])[0];
  const pointerWidth = Math.max(carets.length, 1);
  let start = codePointColumnToUtf16(documentLine, pointerStart);
  let end = codePointColumnToUtf16(documentLine, pointerStart + pointerWidth);

  if (documentLine.length > 0 && start >= documentLine.length) {
    // Keep diagnostics visible when the compiler points at end-of-line/EOF.
    start = Math.max(documentLine.length - 1, 0);
    end = documentLine.length;
  } else if (documentLine.length > 0 && end <= start) {
    end = Math.min(start + 1, documentLine.length);
  }

  return { start, end, sourceMatches: true };
}

module.exports = {
  codePointColumnToUtf16,
  resolvePointerRange,
  sourceLineMatches,
};
