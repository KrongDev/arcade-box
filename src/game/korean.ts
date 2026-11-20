/** 받침 유무에 맞춘 주격 조사 (지뢰찾기가 / 벽돌깨기가 / 중급이). 한글이 아니면 '이(가)' */
export function subjectParticle(word: string): string {
  const code = word.charCodeAt(word.length - 1);
  if (code < 0xac00 || code > 0xd7a3) return '이(가)';
  return (code - 0xac00) % 28 === 0 ? '가' : '이';
}

/** 받침 유무에 맞춘 목적격 조사 (지뢰찾기 고급을 / 벽돌깨기를). 한글이 아니면 '을(를)' */
export function objectParticle(word: string): string {
  const code = word.charCodeAt(word.length - 1);
  if (code < 0xac00 || code > 0xd7a3) return '을(를)';
  return (code - 0xac00) % 28 === 0 ? '를' : '을';
}
