import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import path from "node:path";

// vi.mock()으로 가려진 "@/..." import만 우연히 동작하고, 실제 파일을 relative import 없이
// "@/..." 그대로 테스트에서 불러오면 늘 "Cannot find package" 에러였다(alias 설정이 아예
// 없었음 — institutional-signals.test.ts 작성 중 발견). tsconfig.json의 "@/*": ["./src/*"]와
// 동일하게 맞춘다.
export default defineConfig(({ mode }) => {
  // db.ts를 (직접 또는 transitively) import하는 테스트 파일은 모듈 로드 시점에
  // process.env.DATABASE_URL이 없으면 즉시 throw해서 파일 전체가 0 tests로 스킵됐다
  // (bigtech-reasons.test.ts에서 발견 — "0 failing"이 아니라 "0 collected"라 조용히
  // 커버리지가 사라짐). .env/.env.local을 여기서 읽어 process.env에 채워 넣는다.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ""));

  return {
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
