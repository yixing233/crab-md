import "@testing-library/jest-dom/vitest";

// CodeMirror schedules a deferred measurement that calls Range#getClientRects.
// jsdom does not implement it; keep the compatibility shim worker-wide so one
// test file cannot remove it while another file still has a pending RAF.
if (typeof Range !== "undefined" && typeof Range.prototype.getClientRects !== "function") {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
}
