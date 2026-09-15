const vscode = require("vscode");

const HOVERS = {
  acha: {
    title: "Variable declaration",
    detail: "Declares a variable and assigns its initial value.",
    example: 'acha jina = "Amina"',
  },
  ikiwa: {
    title: "Conditional branch",
    detail: "Runs a block when its condition evaluates to true.",
    example: 'ikiwa (miaka >= 18) { andika("Karibu") }',
  },
  "au ikiwa": {
    title: "Else-if branch",
    detail: "Checks another condition when the previous `ikiwa` branch did not run.",
    example: 'au ikiwa (miaka >= 13) { andika("Kijana") }',
  },
  vinginevyo: {
    title: "Else branch",
    detail: "Runs when the preceding `ikiwa` / `au ikiwa` conditions were false.",
    example: 'vinginevyo { andika("Hapana") }',
  },
  kwa: {
    title: "For loop",
    detail: "Iterates over a collection or range.",
    example: "kwa i katika 1..10 { andika(i) }",
  },
  katika: {
    title: "Iteration connector",
    detail: "Connects the loop variable to the collection or range being iterated.",
    example: "kwa jina katika majina { andika(jina) }",
  },
  wakati: {
    title: "While loop",
    detail: "Repeats a block while its condition remains true.",
    example: "wakati (idadi < 5) { idadi = idadi + 1 }",
  },
  rudisha: {
    title: "Return",
    detail: "Returns a value from the current function.",
    example: "jumlisha(a, b) { rudisha a + b }",
  },
  vunja: {
    title: "Break",
    detail: "Stops the nearest active loop immediately.",
    example: "ikiwa (i == 5) { vunja }",
  },
  endelea: {
    title: "Continue",
    detail: "Skips the rest of the current loop iteration and continues with the next one.",
    example: "ikiwa (i == 5) { endelea }",
  },
  na: {
    title: "Logical AND",
    detail: "True only when both expressions are true.",
    example: "ikiwa (ana_akaunti na amelipa) { ... }",
  },
  au: {
    title: "Logical OR",
    detail: "True when at least one expression is true.",
    example: "ikiwa (ni_admin au ni_msimamizi) { ... }",
  },
  sio: {
    title: "Logical NOT",
    detail: "Negates a boolean expression.",
    example: "ikiwa (sio amefungwa) { ... }",
  },
  kweli: {
    title: "Boolean true",
    detail: "The SwahiliPro boolean value for true.",
    example: "acha hai = kweli",
  },
  uongo: {
    title: "Boolean false",
    detail: "The SwahiliPro boolean value for false.",
    example: "acha imefungwa = uongo",
  },
  andika: {
    title: "Print output",
    detail: "Writes a value to standard output.",
    example: 'andika("Habari Dunia")',
  },
  ingiza: {
    title: "Text input",
    detail: "Reads text input from the user.",
    example: 'acha jina = ingiza("Jina: ")',
  },
  ingiza_namba: {
    title: "Numeric input",
    detail: "Reads numeric input from the user.",
    example: 'acha miaka = ingiza_namba("Miaka: ")',
  },
  futa: {
    title: "Clear output",
    detail: "Clears the current terminal output where supported.",
    example: "futa()",
  },
  endesha: {
    title: "Run a SwahiliPro file",
    detail: "Executes another SwahiliPro source file.",
    example: 'endesha("msaada.swa")',
  },
  urefu: {
    title: "Length",
    detail: "Returns the number of items in a string or list.",
    example: "urefu(majina)",
  },
  ongeza: {
    title: "Append item",
    detail: "Adds one item to the end of a list.",
    example: "ongeza(majina, jina)",
  },
  ondoa: {
    title: "Remove item",
    detail: "Removes an item from a list using the supported list removal semantics.",
    example: "ondoa(majina, 0)",
  },
  extend: {
    title: "Extend list",
    detail: "Adds all items from another list.",
    example: "extend(majina, mengine)",
  },
  ni_namba: {
    title: "Number type check",
    detail: "Returns whether a value is numeric.",
    example: "ni_namba(thamani)",
  },
  ni_neno: {
    title: "String type check",
    detail: "Returns whether a value is text.",
    example: "ni_neno(thamani)",
  },
  ni_orodha: {
    title: "List type check",
    detail: "Returns whether a value is a list.",
    example: "ni_orodha(thamani)",
  },
  ni_function: {
    title: "Function type check",
    detail: "Returns whether a value is callable as a function.",
    example: "ni_function(thamani)",
  },
  PI: {
    title: "Pi constant",
    detail: "The built-in mathematical constant π.",
    example: "acha eneo = PI * r * r",
  },
};

function phraseRangeAtPosition(document, position) {
  const line = document.lineAt(position.line).text;
  const regex = /\bau\s+ikiwa\b/g;
  let match;

  while ((match = regex.exec(line)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (position.character >= start && position.character <= end) {
      return {
        key: "au ikiwa",
        range: new vscode.Range(position.line, start, position.line, end),
      };
    }
  }

  return null;
}

function hoverAtPosition(document, position) {
  const phrase = phraseRangeAtPosition(document, position);
  if (phrase) return phrase;

  const range = document.getWordRangeAtPosition(position, /[A-Za-z_]+/);
  if (!range) return null;

  const key = document.getText(range);
  if (!HOVERS[key]) return null;
  return { key, range };
}

function provideHover(document, position) {
  const match = hoverAtPosition(document, position);
  if (!match) return null;

  const entry = HOVERS[match.key];
  const markdown = new vscode.MarkdownString();
  markdown.appendMarkdown(`**\`${match.key}\` — ${entry.title}**\n\n`);
  markdown.appendMarkdown(`${entry.detail}\n\n`);
  markdown.appendCodeblock(entry.example, "swa");
  markdown.appendMarkdown("\nSwahiliPro v2");

  return new vscode.Hover(markdown, match.range);
}

function registerHoverProvider(context) {
  context.subscriptions.push(
    vscode.languages.registerHoverProvider("swa", { provideHover }),
  );
}

module.exports = { HOVERS, registerHoverProvider };
