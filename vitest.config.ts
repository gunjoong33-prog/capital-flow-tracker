import { defineConfig } from "vitest/config";
import path from "node:path";

// vi.mock()으로 가려진 "@/..." import만 우연히 동작하고, 실제 파일을 relative import 없이
// "@/..." 그대로 테스트에서 불러오면 늘 "Cannot find package" 에러였다(alias 설정이 아예
// 없었음 — institutional-signals.test.ts 작성 중 발견). tsconfig.json의 "@/*": ["./src/*"]와
// 동일하게 맞춘다.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
