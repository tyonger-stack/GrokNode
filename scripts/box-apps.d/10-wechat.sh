#!/usr/bin/env bash
# WeChat 4.1 in the box: reinstall it after every container rebuild, and give
# plank the launcher it needs to show the running window in the dock.
#
# Both halves are needed. `dpkg -i` alone restores the app but not the dock icon:
# plank only attaches a running window to a dock item when the window's
# WM_CLASS matches some .desktop's StartupWMClass, and the vendor
# /usr/share/applications/wechat.desktop ships without that key. Verified in
# grok-node-local-vm: WM_CLASS(STRING) = "wechat", "wechat", the window rendered
# fine, and the icon appeared within 12s of the launcher below existing (plank
# watches ~/.local/share/applications, so no plank restart is needed).
#
# This file is the intent; the in-box host re-runs it from /workspace/box-apps.d
# on every boot (source/host/box/box-desktop-apps.ts). Keep it self-guarding: it
# must be cheap and safe to run again at any time.
set -uo pipefail

DEB=/workspace/installers/wechat.deb
# The desktop session's HOME is /root in this box: plank's dockitems and the
# box's own box-chrome.desktop launcher both live under /root.
LAUNCHER_DIR=/root/.local/share/applications
LAUNCHER="${LAUNCHER_DIR}/wechat-dock.desktop"
BINARY=/usr/bin/wechat

as_root() {
	if [ "$(id -u)" -eq 0 ]; then
		"$@"
	else
		sudo -n "$@"
	fi
}

if [ ! -f "${DEB}" ]; then
	echo "wechat: deb is missing at ${DEB}" >&2
	exit 1
fi

# The binary is the check that matters: a rebuilt container has no /opt/wechat,
# while a live one must not pay a 770MB unpack on every boot.
if [ ! -x "${BINARY}" ]; then
	echo "wechat: installing from ${DEB} (unpacks ~770MB, first boot after a rebuild)"
	if ! as_root dpkg -i "${DEB}"; then
		# dpkg exits non-zero for "installed with warnings" too, so the real
		# verdict is the binary, not the exit code.
		echo "wechat: dpkg -i reported a problem, running dpkg --configure -a" >&2
		as_root dpkg --configure -a >&2 || true
	fi
	if [ ! -x "${BINARY}" ]; then
		echo "wechat: install finished without producing ${BINARY}" >&2
		exit 1
	fi
	echo "wechat: installed"
else
	echo "wechat: already installed"
fi

# Unconditional, so a deleted launcher heals on the next run. Icon path is the
# one the deb installs, and plank shows the app as a running-window item (no
# .dockitem), so the icon is present exactly while WeChat is open.
mkdir -p "${LAUNCHER_DIR}"
cat >"${LAUNCHER}" <<'LAUNCHER_EOF'
[Desktop Entry]
Type=Application
Name=wechat
Name[zh_CN]=微信
Exec=/usr/bin/wechat %U
Icon=/usr/share/icons/hicolor/512x512/apps/wechat.png
StartupWMClass=wechat
Terminal=false
Categories=Network;InstantMessaging;
LAUNCHER_EOF

echo "wechat: launcher in place at ${LAUNCHER}"
