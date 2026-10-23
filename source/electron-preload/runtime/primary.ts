import { installPrimaryPreloadEntrypoint, loadPrimaryPreloadElectron } from "../preload.js";

installPrimaryPreloadEntrypoint(loadPrimaryPreloadElectron(require("electron")));
const desktopMountPreload = "./preload-desktop-mount-panel.cjs";
require(desktopMountPreload);
