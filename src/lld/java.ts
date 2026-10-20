/**
 * A small Java tokenizer for syntax highlighting. It recognizes comments, strings, characters,
 * annotations, keywords, numbers and type-like identifiers. Concatenating the tokens always
 * reproduces the input exactly.
 */
export type TokenKind = 'comment' | 'string' | 'keyword' | 'type' | 'annotation' | 'number' | 'plain';
export type Token = { kind: TokenKind; text: string };

export const JAVA_KEYWORDS = new Set([
  'abstract', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'continue', 'default', 'do', 'double', 'else', 'enum',
  'extends', 'final', 'finally', 'float', 'for', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'new',
  'package', 'private', 'protected', 'public', 'record', 'return', 'sealed', 'permits', 'short', 'static', 'super', 'switch',
  'synchronized', 'this', 'throw', 'throws', 'try', 'var', 'void', 'volatile', 'while', 'true', 'false', 'null', 'yield',
]);

const PATTERN = /(\/\*[\s\S]*?\*\/|\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|(@[A-Za-z_]\w*)|(\b\d[\d_]*(?:\.\d+)?[lLfFdD]?\b)|([A-Za-z_$][\w$]*)/g;

export function tokenizeJava(source: string): Token[] {
  const tokens: Token[] = []; let last = 0;
  const push = (kind: TokenKind, text: string) => {
    if (!text) return;
    const previous = tokens[tokens.length - 1];
    if (previous && previous.kind === kind && kind === 'plain') previous.text += text; else tokens.push({ kind, text });
  };
  for (const match of source.matchAll(PATTERN)) {
    const start = match.index ?? 0; push('plain', source.slice(last, start));
    const [text, comment, string, annotation, number, word] = match;
    if (comment) push('comment', text);
    else if (string) push('string', text);
    else if (annotation) push('annotation', text);
    else if (number) push('number', text);
    else if (word) push(JAVA_KEYWORDS.has(word) ? 'keyword' : /^[A-Z]/.test(word) ? 'type' : 'plain', text);
    last = start + text.length;
  }
  push('plain', source.slice(last));
  return tokens;
}

/** Source with comments and string literals blanked out, for structural checks. */
export const stripJava = (source: string) => tokenizeJava(source).map(token => token.kind === 'comment' || token.kind === 'string' ? ' ' : token.text).join('');
