#!/bin/sh
# launchd KeepAlive is the watchdog: exec bridge.py directly, launchd restarts on exit.
exec /usr/bin/python3 /Users/Apple/.groknode/feishu-inbox/bridge.py
