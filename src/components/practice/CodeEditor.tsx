import { useMemo } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { cpp } from '@codemirror/lang-cpp'
import { Decoration, EditorView } from '@codemirror/view'
import { RangeSetBuilder } from '@codemirror/state'
import { useTheme } from '../../lib/theme'

export interface LineMark { line: number; kind: 'error' | 'read' | 'write' | 'warn' }

const CLASS: Record<LineMark['kind'], string> = { error: 'cm-line-error', read: 'cm-line-read', write: 'cm-line-write', warn: 'cm-line-warn' }

const baseTheme = EditorView.baseTheme({
  '.cm-line-error': { backgroundColor: 'rgba(239, 68, 68, 0.22)' },
  '.cm-line-warn': { backgroundColor: 'rgba(234, 179, 8, 0.18)' },
  '.cm-line-read': { backgroundColor: 'rgba(59, 130, 246, 0.18)' },
  '.cm-line-write': { backgroundColor: 'rgba(245, 158, 11, 0.22)' },
})

function marksExtension(marks: LineMark[]) {
  return EditorView.decorations.of((view) => {
    const b = new RangeSetBuilder<Decoration>()
    const sorted = [...marks].filter((m) => m.line >= 1 && m.line <= view.state.doc.lines).sort((a, c) => a.line - c.line)
    let last = -1
    for (const m of sorted) {
      if (m.line === last) continue
      last = m.line
      const l = view.state.doc.line(m.line)
      b.add(l.from, l.from, Decoration.line({ class: CLASS[m.kind] }))
    }
    return b.finish()
  })
}

export default function CodeEditor({ value, onChange, marks = [], readOnly = false, label = '아두이노 코드 에디터' }: {
  value: string; onChange?: (v: string) => void; marks?: LineMark[]; readOnly?: boolean; label?: string
}) {
  const { theme } = useTheme()
  const key = marks.map((m) => `${m.kind}${m.line}`).join(',')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const extensions = useMemo(() => [cpp(), baseTheme, marksExtension(marks), EditorView.lineWrapping], [key])
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={extensions}
      theme={theme}
      height="100%"
      readOnly={readOnly}
      editable={!readOnly}
      className="h-full text-[13px]"
      aria-label={label}
      basicSetup={{ tabSize: 2, foldGutter: false, highlightActiveLine: !readOnly }}
    />
  )
}
