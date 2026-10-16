const livePorts = new Set();
const NativeMessageChannel = globalThis.MessageChannel;
if (typeof NativeMessageChannel === "function") {
  const TrackedMessageChannel = function (...args) {
    const channel = new NativeMessageChannel(...args);
    livePorts.add(channel.port1);
    livePorts.add(channel.port2);
    return channel;
  };
  Object.setPrototypeOf(TrackedMessageChannel, NativeMessageChannel);
  globalThis.MessageChannel = TrackedMessageChannel;
}
export async function closeLibraryDom(window) {
  try {
    await window.happyDOM.close();
  } catch {
    try {
      window.close();
    } catch {
      /* the window is already gone */
    }
  }
  for (const port of livePorts) {
    try {
      port.close();
    } catch {
      /* a port owned elsewhere stays untouched */
    }
  }
  livePorts.clear();
}
