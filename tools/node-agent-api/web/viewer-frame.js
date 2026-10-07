export function observeFirstFrame(rfb, notify, { requestFrame = requestAnimationFrame, cancelFrame = cancelAnimationFrame } = {}) {
  const handleRect = rfb._handleRect, framebufferUpdate = rfb._framebufferUpdate;
  let rectangles = 0, complete = false, disposed = false, frame;
  function rect(...args) {
    const encoding = this._FBU.encoding;
    const result = handleRect.apply(this, args);
    if (result && encoding >= 0 && this._FBU.width > 0 && this._FBU.height > 0) rectangles++;
    return result;
  }
  function update(...args) {
    const result = framebufferUpdate.apply(this, args);
    if (result && rectangles > 0 && !complete && !disposed) {
      complete = true;
      const show = () => {
        if (disposed) return;
        if (rfb._display.pending()) { frame = requestFrame(show); return; }
        notify({ width: rfb._fb_width, height: rfb._fb_height });
      };
      frame = requestFrame(show);
    }
    if (result) rectangles = 0;
    return result;
  }
  rfb._handleRect = rect;
  rfb._framebufferUpdate = update;
  return () => {
    disposed = true;
    if (frame !== undefined) cancelFrame(frame);
    if (rfb._handleRect === rect) rfb._handleRect = handleRect;
    if (rfb._framebufferUpdate === update) rfb._framebufferUpdate = framebufferUpdate;
  };
}
