// 한국어 조사 자동 선택: 받침 유무에 따라 은/는, 이/가, 을/를, 와/과
const PAIRS: Record<string, [string, string]> = {
  '은는': ['은', '는'], '이가': ['이', '가'], '을를': ['을', '를'], '와과': ['과', '와'], '으로로': ['으로', '로'],
}

export function hasBatchim(word: string) {
  const ch = word.trim().slice(-1)
  const code = ch.charCodeAt(0) - 0xac00
  if (code < 0 || code > 11171) return /[013678LMNR]$/i.test(ch) // 숫자/영문 대략 처리
  return code % 28 !== 0
}

/** josa('푸시버튼', '와과') → '푸시버튼과' */
export function josa(word: string, kind: keyof typeof PAIRS | string) {
  const pair = PAIRS[kind]
  if (!pair) return word + kind
  const [withB, without] = pair
  if (kind === '으로로') {
    const last = word.trim().slice(-1).charCodeAt(0) - 0xac00
    const rieul = last >= 0 && last % 28 === 8
    return word + (hasBatchim(word) && !rieul ? withB : without)
  }
  return word + (hasBatchim(word) ? withB : without)
}
