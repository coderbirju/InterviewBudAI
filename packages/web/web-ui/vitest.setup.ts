import '@testing-library/jest-dom/vitest';

// ADR 0014 D2: CodeMirror measures text through Range rects, which jsdom does
// not implement. Empty rects are enough for the component tests.
const emptyRect = (): DOMRect =>
  ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    toJSON: () => ({}),
  }) as DOMRect;
if (typeof Range !== 'undefined') {
  Range.prototype.getBoundingClientRect = emptyRect;
  Range.prototype.getClientRects = () =>
    Object.assign([] as DOMRect[], {
      item: () => null,
    }) as unknown as DOMRectList;
}
