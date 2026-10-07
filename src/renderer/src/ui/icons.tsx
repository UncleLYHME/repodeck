// RepoDeck's own symbolic icons (from data/icons), drawn in currentColor, plus file-type icons.

import type { SVGProps } from 'react'
import { File, FileCode2, FileImage, FileJson2, FileText, FileArchive, Settings2 } from 'lucide-react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Glyph({ d, size = 16, evenOdd, ...rest }: IconProps & { d: string; evenOdd?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" {...rest}>
      <path fill="currentColor" fillRule={evenOdd ? 'evenodd' : undefined} d={d} />
    </svg>
  )
}

export const ActivityIcon = (p: IconProps) => <Glyph {...p} d="M1 14h14v1.5H1zM2 8h2.5v5H2zm4-5h2.5v10H6zm4 3h2.5v7H10z" />
export const BranchIcon = (p: IconProps) => (
  <Glyph {...p} evenOdd d="M4 1a2.5 2.5 0 0 1 .75 4.89v4.22a2.5 2.5 0 1 1-1.5 0V5.89A2.5 2.5 0 0 1 4 1zm0 1.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm0 9a1 1 0 1 0 0 2 1 1 0 0 0 0-2zM12 1a2.5 2.5 0 0 1 .75 4.89V6.5A3.5 3.5 0 0 1 9.25 10H4.75V8.5h4.5a2 2 0 0 0 2-2v-.61A2.5 2.5 0 0 1 12 1zm0 1.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2z" />
)
export const CommitIcon = (p: IconProps) => (
  <Glyph {...p} evenOdd d="M8 4.5a3.5 3.5 0 0 1 3.43 2.75H16v1.5h-4.57a3.5 3.5 0 0 1-6.86 0H0v-1.5h4.57A3.5 3.5 0 0 1 8 4.5zM8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
)
export const PullRequestIcon = (p: IconProps) => (
  <Glyph {...p} evenOdd d="M4 1a2.5 2.5 0 0 1 .75 4.89v4.22a2.5 2.5 0 1 1-1.5 0V5.89A2.5 2.5 0 0 1 4 1zm0 1.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm0 9a1 1 0 1 0 0 2 1 1 0 0 0 0-2zM9 1v2h1.5A2.5 2.5 0 0 1 13 5.5v4.61a2.5 2.5 0 1 1-1.5 0V5.5a1 1 0 0 0-1-1H9v2L6.5 3.75zm3.25 10.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2z" />
)

const CODE = /\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|h|cpp|hpp|cs|php|lua|dart|ex|exs|sh|bash|zsh|vue|svelte|html|htm|css|scss|sql|tf)$/i
const IMAGE = /\.(png|jpe?g|gif|webp|svg|ico|bmp|avif)$/i
const DATA = /\.(json|jsonc|ya?ml|toml|xml|csv)$/i
const TEXT = /\.(md|mdx|txt|rst|log)$/i
const ARCHIVE = /\.(zip|tar|gz|tgz|xz|7z|rar|lock)$/i
const CONFIG = /(^|\/)(\.[^/]+rc|\.env[^/]*|\.gitignore|\.editorconfig|Dockerfile|Makefile)$/

export function FileIcon({ path, size = 15 }: { path: string; size?: number }) {
  const props = { size, className: 'flex-none text-white/55', 'aria-hidden': true }
  if (CONFIG.test(path)) return <Settings2 {...props} />
  if (CODE.test(path)) return <FileCode2 {...props} />
  if (IMAGE.test(path)) return <FileImage {...props} />
  if (DATA.test(path)) return <FileJson2 {...props} />
  if (TEXT.test(path)) return <FileText {...props} />
  if (ARCHIVE.test(path)) return <FileArchive {...props} />
  return <File {...props} />
}
