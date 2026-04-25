import { exec } from 'node:child_process';
import type { AlertChannel, AlertPayload } from '../dispatcher.js';

export class DesktopChannel implements AlertChannel {
  name = 'desktop';

  async send(alert: AlertPayload): Promise<void> {
    const title = `Puffer: ${alert.severity.toUpperCase()}`;
    const message = `${alert.event.agent}: ${alert.message}`.slice(0, 200);

    const platform = process.platform;

    if (platform === 'linux') {
      await this.execCommand(
        `notify-send -u ${alert.severity === 'critical' ? 'critical' : 'normal'} "${esc(title)}" "${esc(message)}"`,
      );
    } else if (platform === 'darwin') {
      await this.execCommand(
        `osascript -e 'display notification "${esc(message)}" with title "${esc(title)}"'`,
      );
    } else if (platform === 'win32') {
      // PowerShell toast notification
      const ps = `[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms'); $n = New-Object System.Windows.Forms.NotifyIcon; $n.Icon = [System.Drawing.SystemIcons]::Warning; $n.Visible = $true; $n.ShowBalloonTip(5000, '${esc(title)}', '${esc(message)}', 'Warning')`;
      await this.execCommand(`powershell -Command "${ps}"`);
    }
  }

  private execCommand(cmd: string): Promise<void> {
    return new Promise((resolve) => {
      exec(cmd, (_err) => {
        // Best effort — don't fail the alert pipeline on notification errors
        resolve();
      });
    });
  }
}

function esc(str: string): string {
  return str.replace(/["'\\]/g, '');
}
