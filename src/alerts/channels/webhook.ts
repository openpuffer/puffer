import type { AlertChannel, AlertPayload } from '../dispatcher.js';

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#dc2626',
  high: '#f59e0b',
  medium: '#3b82f6',
  low: '#22c55e',
};

const SEVERITY_EMOJI: Record<string, string> = {
  critical: '🚨',
  high: '⚠️',
  medium: 'ℹ️',
  low: '✅',
};

function severityColor(severity: string): string {
  return SEVERITY_COLORS[severity] ?? '#6b7280';
}

export class WebhookChannel implements AlertChannel {
  name = 'webhook';
  private url: string;

  constructor(url: string) {
    this.url = url;
  }

  async send(alert: AlertPayload): Promise<void> {
    // Detect Slack/Discord/Teams by URL pattern
    if (this.url.includes('hooks.slack.com')) {
      await this.sendSlack(alert);
    } else if (this.url.includes('discord.com/api/webhooks')) {
      await this.sendDiscord(alert);
    } else if (this.url.includes('webhook.office.com') || this.url.includes('teams')) {
      await this.sendTeams(alert);
    } else {
      await this.sendGeneric(alert);
    }
  }

  private async sendSlack(alert: AlertPayload): Promise<void> {
    const body = {
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: `${SEVERITY_EMOJI[alert.severity]} ${alert.title}` },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Agent:* ${alert.event.agent}` },
            { type: 'mrkdwn', text: `*Severity:* ${alert.severity.toUpperCase()}` },
            { type: 'mrkdwn', text: `*Action:* ${alert.event.action}` },
            { type: 'mrkdwn', text: `*Layer:* ${alert.event.layer ?? 'N/A'}` },
          ],
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `> ${alert.message}` },
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `🐡 Puffer | Event: \`${alert.event.id.slice(0, 8)}\` | ${alert.timestamp}`,
            },
          ],
        },
      ],
    };

    await this.post(body);
  }

  private async sendDiscord(alert: AlertPayload): Promise<void> {
    const body = {
      embeds: [
        {
          title: `${SEVERITY_EMOJI[alert.severity]} ${alert.title}`,
          description: alert.message,
          color: parseInt(severityColor(alert.severity).slice(1), 16),
          fields: [
            { name: 'Agent', value: alert.event.agent, inline: true },
            { name: 'Severity', value: alert.severity.toUpperCase(), inline: true },
            { name: 'Layer', value: alert.event.layer ?? 'N/A', inline: true },
          ],
          footer: { text: `🐡 Puffer | ${alert.event.id.slice(0, 8)}` },
          timestamp: alert.timestamp,
        },
      ],
    };

    await this.post(body);
  }

  private async sendTeams(alert: AlertPayload): Promise<void> {
    const body = {
      '@type': 'MessageCard',
      themeColor: severityColor(alert.severity).slice(1),
      summary: alert.title,
      sections: [
        {
          activityTitle: `${SEVERITY_EMOJI[alert.severity]} ${alert.title}`,
          facts: [
            { name: 'Agent', value: alert.event.agent },
            { name: 'Severity', value: alert.severity.toUpperCase() },
            { name: 'Action', value: alert.event.action },
            { name: 'Layer', value: alert.event.layer ?? 'N/A' },
          ],
          text: alert.message,
        },
      ],
    };

    await this.post(body);
  }

  private async sendGeneric(alert: AlertPayload): Promise<void> {
    await this.post(alert);
  }

  private async post(body: unknown): Promise<void> {
    const resp = await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    if (!resp.ok) {
      throw new Error(`Webhook returned ${resp.status}: ${resp.statusText}`);
    }
  }
}
