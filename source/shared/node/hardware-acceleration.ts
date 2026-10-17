/**
 * Hardware-acceleration preference policy, ported from Grok Bot 0.71.2
 * `main-core.cjs` (`TF` / `AF` / `RF` / `Aie`).
 *
 * Evidence (0.71.2 main-core.cjs):
 *   TF(e){return e.storedPreference??(e.platform==="darwin"||e.platform==="win32")}
 *   AF(e){…;let t=TF(e);return t||(e.app.disableHardwareAcceleration(),
 *        e.app.commandLine.appendSwitch("disable-gpu")),t}
 *   RF(e){return{enabled:TF(e),enabledAtLaunch:e.enabledAtLaunch,
 *        pdfRasterMode:Aie(e.gpuFeatureStatus)}}
 * Schema field `hardwareAccelerationEnabled` is optional; undefined → platform default.
 */

export type HardwareAccelerationGpuFeatureStatus = {
  readonly rasterization?: string;
  readonly gpu_compositing?: string;
  readonly [key: string]: string | undefined;
};

export type HardwareAccelerationSetting = {
  readonly enabled: boolean;
  readonly enabledAtLaunch: boolean;
  readonly pdfRasterMode: "gpu" | "software";
};

/** Snapshot of the policy applied before Chromium's GPU decision is fixed. */
let enabledAtLaunchSnapshot: boolean | undefined;

export function resolveHardwareAccelerationEnabled(
  storedPreference: boolean | undefined,
  platform: string,
): boolean {
  return storedPreference ?? (platform === "darwin" || platform === "win32");
}

function pdfRasterModeFromGpuStatus(
  gpuFeatureStatus: HardwareAccelerationGpuFeatureStatus | undefined,
): "gpu" | "software" {
  const rasterization = gpuFeatureStatus?.rasterization;
  if (rasterization === "enabled" || (typeof rasterization === "string" && rasterization.startsWith("enabled_"))) {
    return "gpu";
  }
  return "software";
}

export function currentHardwareAccelerationSetting(args: {
  readonly storedPreference: boolean | undefined;
  readonly platform: string;
  readonly enabledAtLaunch: boolean;
  readonly gpuFeatureStatus?: HardwareAccelerationGpuFeatureStatus;
}): HardwareAccelerationSetting {
  return {
    enabled: resolveHardwareAccelerationEnabled(args.storedPreference, args.platform),
    enabledAtLaunch: args.enabledAtLaunch,
    pdfRasterMode: pdfRasterModeFromGpuStatus(args.gpuFeatureStatus),
  };
}

export type HardwareAccelerationAppPort = {
  readonly isReady: () => boolean;
  readonly disableHardwareAcceleration: () => void;
  readonly commandLine: { readonly appendSwitch: (name: string, value?: string) => void };
};

/**
 * Applies the 0.71.2 AF() policy. Must run before `app.whenReady()`.
 * When the resolved preference is false, disables HW accel and appends `disable-gpu`
 * (both — matching 0.71; do not invent other switches).
 * Returns the enabled-at-launch boolean and records it for later RPC projection.
 */
export function applyHardwareAccelerationPolicy(args: {
  readonly app: HardwareAccelerationAppPort;
  readonly storedPreference: boolean | undefined;
  readonly platform: string;
}): boolean {
  if (args.app.isReady()) {
    throw new Error(
      "The hardware-acceleration policy applied after app ready; Chromium's GPU decision is already fixed.",
    );
  }
  const enabled = resolveHardwareAccelerationEnabled(args.storedPreference, args.platform);
  if (!enabled) {
    args.app.disableHardwareAcceleration();
    args.app.commandLine.appendSwitch("disable-gpu");
  }
  enabledAtLaunchSnapshot = enabled;
  return enabled;
}

export function getHardwareAccelerationEnabledAtLaunch(): boolean {
  if (enabledAtLaunchSnapshot !== undefined) return enabledAtLaunchSnapshot;
  // Pre-policy reads (unit tests) fall back to the darwin/win32 default.
  return resolveHardwareAccelerationEnabled(undefined, process.platform);
}

/** Test-only: clear the launch snapshot between cases. */
export function resetHardwareAccelerationEnabledAtLaunchForTests(): void {
  enabledAtLaunchSnapshot = undefined;
}
