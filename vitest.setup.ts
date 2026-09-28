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

// CodeMirror schedules a deferred measurement that calls Range#getClientRects.
// jsdom does not implement it; keep the compatibility shim worker-wide so one
// test file cannot remove it while another file still has a pending RAF.
if (typeof Range !== "undefined" && typeof Range.prototype.getClientRects !== "function") {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
}
