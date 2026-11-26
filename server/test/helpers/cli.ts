import type { CliIo } from '../../src/shared/cli/index.ts';

/** 명령줄 테스트용 입출력: 나온 줄과 받은 질문을 모으고, 확인 질문에는 정해 둔 답을 한다 */
export function fakeIo(answer = true): CliIo & { lines: string[]; questions: string[]; text(): string } {
  const lines: string[] = [];
  const questions: string[] = [];
  return {
    lines,
    questions,
    text: () => lines.join('\n'),
    out: (line) => {
      lines.push(line);
    },
    confirm: async (question) => {
      questions.push(question);
      return answer;
    },
  };
}
