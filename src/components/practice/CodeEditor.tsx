import CodeMirror from '@uiw/react-codemirror'
import { cpp } from '@codemirror/lang-cpp'
import { useTheme } from '../../lib/theme'

const extensions = [cpp()]

export default function CodeEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { theme } = useTheme()
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={extensions}
      theme={theme}
      height="100%"
      className="h-full text-[13px]"
      aria-label="아두이노 코드 에디터"
      basicSetup={{ tabSize: 2, foldGutter: false }}
    />
  )
}
