import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // 날짜별 리포트 퍼머링크는 실제로 /calendar/[date]에 있다 — 외부 감사가 존재하지 않는
      // /report/[date] 경로를 기대해 "공유·북마크 불가"로 지적한 문제를 리다이렉트로 해소.
      {
        source: "/report/:date",
        destination: "/calendar/:date",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
