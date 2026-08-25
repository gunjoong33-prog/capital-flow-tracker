// scripts/check-protected-files.ts
// GitHub Actions 워크플로가 `git diff --name-only`로 변경 파일 목록을 얻어 이 스크립트에 넘긴다.
// 보호 파일이 하나라도 섞여 있으면 exit code 1로 워크플로 자체를 실패시킨다(병합 차단).
import { pathToFileURL } from "node:url";
import { PROTECTED_FILES } from "../src/lib/protected-files";

export function checkProtectedFiles(changedFiles: string[]): { ok: boolean; violated: string[] } {
  const violated = changedFiles.filter((f) => PROTECTED_FILES.includes(f));
  return { ok: violated.length === 0, violated };
}

// `tsx scripts/check-protected-files.ts <changed-file-1> <changed-file-2> ...`로 실행.
// import.meta.url === entry 체크로 테스트 시(vitest import)에는 이 블록이 안 돌게 한다.
// 단순 `file://${process.argv[1]}` 문자열 비교는 Windows(경로 구분자 \, 드라이브 문자 인코딩)에서
// import.meta.url과 절대 일치하지 않아 이 블록이 조용히 아예 안 도는 실패 모드가 있었다(exit 0,
// 출력 없음 — 보호파일이 실제로 인자로 들어와도 가드가 통과된 것처럼 보임). pathToFileURL로 양쪽을
// 같은 방식으로 정규화해 플랫폼 무관하게 비교한다.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const changedFiles = process.argv.slice(2);
  const { ok, violated } = checkProtectedFiles(changedFiles);
  if (!ok) {
    console.error(`보호 파일 변경 감지 — 자동수정 중단: ${violated.join(", ")}`);
    process.exit(1);
  }
  console.log("보호 파일 변경 없음 — 통과");
}
