/**
 * A source file with its comments blanked, for asserting what the CODE says.
 *
 * A security spec that asserts a name is absent must not fail because a
 * comment explains why the name went away. The Solicitor Portal's handlers
 * record their own history in comments, and that is where a reader needs it.
 * Every other character, line breaks included, keeps its position, so an
 * index taken from this string is an index into the file.
 *
 * The same rule as `stripComments` in `scripts/security/lib/entrypointSource.mjs`:
 * a `//` after a `:` is a URL, not a comment.
 */
export function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\\])\/\/[^\n]*/g, (line, before: string) => before + ' '.repeat(line.length - before.length));
}
