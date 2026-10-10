import "@testing-library/jest-dom/vitest";

// Ant Design (and responsive components) require window.matchMedia in jsdom.
if (typeof window !== "undefined" && !window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

// rc-trigger / @rc-component/resize-observer 依赖 ResizeObserver
// 做定位测量；jsdom 未实现，提供一个最小 stub。
class ResizeObserverStub {
  constructor(_callback?: unknown) {}
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub;
if (typeof window !== "undefined") {
  (window as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
    ResizeObserverStub;
}

// CodeMirror schedules a deferred measurement that calls Range#getClientRects.
// jsdom does not implement it; keep the compatibility shim worker-wide so one
// test file cannot remove it while another file still has a pending RAF.
if (typeof Range !== "undefined" && typeof Range.prototype.getClientRects !== "function") {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
}
