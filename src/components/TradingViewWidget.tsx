"use client";

import { useEffect, useRef } from "react";

/**
 * 트레이딩뷰 공식 임베드 위젯(티커테이프·히트맵·미니차트·기술적분석 등) 공용 마운트 컴포넌트.
 * 위젯 스크립트가 로드되면서 자기 자신을 컨테이너 안에 iframe으로 주입하는 방식이라
 * (React가 아니라 위젯 스크립트가 직접 DOM을 건드림) 클라이언트에서만 실행해야 한다.
 */
export function TradingViewWidget({ src, config }: { src: string; config: Record<string, unknown> }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = "";

    const widgetDiv = document.createElement("div");
    widgetDiv.className = "tradingview-widget-container__widget";
    container.appendChild(widgetDiv);

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.type = "text/javascript";
    script.text = JSON.stringify(config);
    container.appendChild(script);

    return () => {
      container.innerHTML = "";
    };
  }, [src, config]);

  return <div ref={containerRef} className="tradingview-widget-container h-full w-full" />;
}
