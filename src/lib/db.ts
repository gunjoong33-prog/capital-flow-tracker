import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// Next.js 개발 서버는 핫리로드마다 모듈을 다시 평가하므로,
// 전역에 캐싱하지 않으면 매번 새 커넥션 풀이 생겨 DB 연결이 금방 고갈된다.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL이 설정되지 않았다. .env에 Postgres 연결 문자열을 넣어야 한다."
    );
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
