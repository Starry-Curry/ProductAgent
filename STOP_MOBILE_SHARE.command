#!/bin/zsh
launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.wujian.pc-host.plist" 2>/dev/null
print '已停止物间电脑共享。再次双击 START_MOBILE_SHARE.command 可以恢复。'
