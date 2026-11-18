// 대소문자를 무시한 이름 오름차순. 그 외에는 문자 코드 순서(영문이 한글보다 앞)
export const byNameIgnoringCase = (a: { name: string }, b: { name: string }) => {
  const x = a.name.toLowerCase();
  const y = b.name.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
};
