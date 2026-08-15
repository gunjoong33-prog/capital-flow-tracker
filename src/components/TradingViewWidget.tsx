"use client";

import { useEffect, useRef } from "react";

/**
 * 트레이딩뷰 공식 임베드 위젯(티커테이프·히트맵·미니차트·기술적분석 등) 공용 마운트 컴포넌트.
 * 위젯 스크립트가 로드되면서 자기 자신을 컨테이너 안에 iframe으로 주입하는 방식이라
 * (React가 아니라 위젯 스크립트가 직접 DOM을 건드림) 클라이언트에서만 실행해야 한다.
 */
export function TradingViewWidget({ src, config }: { src: string; config: Record<string, unknown> }) {
  const containerRef = useRef<HTMLDivElement>(null);
  // config는 호출부(TradingViewSection)에서 매 렌더마다 새로 만드는 객체 리터럴이라 참조가 항상
  // 바뀐다 — 의존성 배열에 config 자체를 넣으면 내용이 같아도(예: colorTheme 등 값이 그대로여도)
  // 매 렌더마다 이 effect가 재실행돼 컨테이너를 비우고 스크립트를 다시 주입한다. 트레이딩뷰 위젯
  // 스크립트는 비동기로 초기화되는데 그 도중에 컨테이너가 통째로 비워지면 스크립트가 이미 죽은
  // DOM 노드를 참조하다 "Cannot read properties of null (reading 'querySelector')" 예외를 던지고
  // 위젯이 잠깐 빈 화면으로 보이는 원인이 됐다. 내용이 실제로 같으면 재실행하지 않도록 문자열화한
  // 값을 의존성으로 쓴다(참조가 아니라 값 비교).
  const configKey = JSON.stringify(config);

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
    script.text = configKey;
    container.appendChild(script);

    return () => {
      container.innerHTML = "";
    };
  }, [src, configKey]);

  return <div ref={containerRef} className="tradingview-widget-container h-full w-full" />;
}
