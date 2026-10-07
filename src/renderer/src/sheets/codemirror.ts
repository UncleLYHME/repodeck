// CodeMirror setup for read-only comparisons: dark theme, syntax colors, language by file name.

import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
import { HighlightStyle, LanguageDescription, syntaxHighlighting } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { tags as t } from '@lezer/highlight'

const theme = EditorView.theme({
  '&': { backgroundColor: 'transparent', color: '#e3e4e8', fontSize: '12.5px', height: '100%' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.55' },
  '.cm-content': { padding: '6px 0', caretColor: 'transparent' },
  '.cm-gutters': { backgroundColor: 'transparent', color: 'rgb(255 255 255 / 0.32)', border: 'none' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 12px' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'rgb(59 111 224 / 0.35) !important' },
  // changes: whole lines tinted, changed words stronger (same colors as the GTK version)
  '.cm-changedLine, &.cm-merge-b .cm-changedLine': { backgroundColor: 'rgb(63 185 80 / 0.13)' },
  '&.cm-merge-a .cm-changedLine, .cm-deletedChunk': { backgroundColor: 'rgb(248 81 73 / 0.13)' },
  '&.cm-merge-b .cm-changedText, .cm-insertedLine .cm-changedText': { background: 'rgb(63 185 80 / 0.38)' },
  '&.cm-merge-a .cm-changedText, .cm-deletedChunk .cm-deletedText': { background: 'rgb(248 81 73 / 0.38)' },
  '.cm-insertedLine': { backgroundColor: 'rgb(63 185 80 / 0.13)' },
  '.cm-deletedLine': { backgroundColor: 'rgb(248 81 73 / 0.13)' },
  '.cm-changeGutter': { width: '3px', paddingLeft: '0' },
  '&.cm-merge-a .cm-changedLineGutter, .cm-deletedLineGutter': { background: '#f85149' },
  '&.cm-merge-b .cm-changedLineGutter, .cm-changedLineGutter': { background: '#3fb950' },
  '.cm-mergeSpacer': { backgroundColor: 'rgb(255 255 255 / 0.025)' },
  '.cm-collapsedLines': { backgroundColor: 'rgb(255 255 255 / 0.04)', color: 'rgb(255 255 255 / 0.5)' },
}, { dark: true })

const colors = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword], color: '#ff7b9c' },
  { tag: [t.string, t.special(t.string), t.regexp], color: '#a5d6a7' },
  { tag: [t.number, t.bool, t.null, t.atom], color: '#f2b46d' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: '#7b8091', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#82aaff' },
  { tag: [t.typeName, t.className, t.namespace], color: '#e0b25c' },
  { tag: [t.propertyName, t.attributeName], color: '#9ccfd8' },
  { tag: [t.tagName, t.heading], color: '#ff9e64', fontWeight: '600' },
  { tag: [t.link, t.url], color: '#7ea2ff', textDecoration: 'underline' },
  { tag: [t.meta, t.processingInstruction], color: '#c792ea' },
  { tag: t.invalid, color: '#ff6b62' },
])

export const readOnly: Extension = [
  theme,
  syntaxHighlighting(colors),
  lineNumbers(),
  EditorState.readOnly.of(true),
  EditorView.editable.of(false),
  EditorView.contentAttributes.of({ tabindex: '0' }),
]

/** Syntax highlighting for this file name, if CodeMirror knows the language. */
export async function languageFor(filename: string): Promise<Extension> {
  const desc = LanguageDescription.matchFilename(languages, filename)
  if (!desc) return []
  try {
    return await desc.load()
  } catch {
    return []
  }
}
