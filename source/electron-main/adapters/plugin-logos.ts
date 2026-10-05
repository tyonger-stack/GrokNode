// 把 Electron 的 `nativeImage` / `app.getPath` 绑到 `plugin-logo-cache` 的端口上。
//
// 为什么单独一个适配器：`source/shared/` 与 `source/host/` 从不 import electron，
// 而 `source/electron-main/adapters/` 里用 `require("electron")` 是既有惯例
// （`avatar-images.ts` / `attachment-gateway.ts` / `telemetry.ts` / `ipc.ts` 同款）。
// 官方那边也是同一个形状：`displaySizedLogo: RJe`，`RJe` 的默认参数就是
// `createFromDataURL: i => MG.nativeImage.createFromDataURL(i)`、
// `cacheDir: join(MG.app.getPath("userData"), "plugin-logo-cache")`。
//
// ABI 不完整时**降级为原样透传**（不抛错）：缺 nativeImage 只意味着图标不缩放，
// 不该让整个市场不可用。这与官方 `requireFunction` 抛错的风格不同，理由是我们这一层
// 是可选增强 —— 上游产物本来就带 0.18 的渲染器降级路径。
import { join } from "node:path";
import { createDisplaySizedLogo, LOGO_DISPLAY_CACHE_DIRNAME } from "../mcp/plugin-logo-cache.js";

interface ElectronLogoPorts {
  readonly app: { getPath(name: "userData"): string };
  readonly nativeImage: {
    createFromDataURL(dataUrl: string): {
      isEmpty(): boolean;
      getSize(): { width: number; height: number };
      resize(options: { width: number; height: number; quality: string }): { toDataURL(): string };
    };
  };
}

function usable(ports: ElectronLogoPorts | undefined): ports is ElectronLogoPorts {
  return (
    ports != null &&
    typeof ports.app?.getPath === "function" &&
    typeof ports.nativeImage?.createFromDataURL === "function"
  );
}

/**
 * 构造 `displaySizedLogo`。electron 不可用（纯 node 运行时、测试、CLI）时返回 null，
 * 调用方据此走透传路径。
 */
export function createPluginLogoDisplaySizer(
  electron: unknown = tryRequireElectron(),
): (url: string, fetchDataUrl: () => Promise<string | null>) => Promise<string | null> {
  const ports = electron as ElectronLogoPorts | undefined;
  if (!usable(ports)) {
    return async (_url, fetchDataUrl) => await fetchDataUrl();
  }
  const displaySizedLogo = createDisplaySizedLogo({
    createFromDataURL: (dataUrl) => ports.nativeImage.createFromDataURL(dataUrl),
    cacheDir: join(ports.app.getPath("userData"), LOGO_DISPLAY_CACHE_DIRNAME),
  });
  return async (url, fetchDataUrl) => await displaySizedLogo(url, fetchDataUrl);
}

function tryRequireElectron(): unknown {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("electron");
  } catch {
    return null;
  }
}
