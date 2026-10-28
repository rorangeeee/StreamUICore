export interface ChatEntry {
  key: string | null;
  kind: 'message' | 'gift' | 'superchat';
  timestamp: number;
  username: string;
  level: string;
  body: string;
}

/** Display the normalized sending timestamp in the viewer's local timezone. */
export function formatChatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

const text = (value: unknown): string => typeof value === 'string' ? value.replace(/[\r\n\t\u0000-\u001f\u007f]+/g, ' ').trim() : '';
const number = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const amountFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2, useGrouping: false });

/** Convert only displayable live events; bridge control messages never enter the log. */
export class ChatEventFormatter {
  private levels = new Map<string, number>();

  format(input: unknown, receivedAt = Date.now()): ChatEntry | null {
    const event = record(input);
    if (!event || !['message', 'gift', 'superchat'].includes(String(event.type))) return null;
    const kind = event.type as ChatEntry['kind'];
    if (kind === 'superchat' && event.deleted === true) return null;

    const userKey = typeof event.uid === 'number' && event.uid !== 0 ? `${event.origin}:${event.uid}` : null;
    const eventLevel = number(event.userLvl);
    if (userKey && eventLevel !== null) {
      this.levels.delete(userKey);
      this.levels.set(userKey, Math.floor(eventLevel));
      if (this.levels.size > 2000) this.levels.delete(this.levels.keys().next().value!);
    }
    const userLevel = eventLevel ?? (userKey ? this.levels.get(userKey) : undefined);
    const medal = record(event.medal);
    const medalLevel = number(medal?.level);
    const level = `UL ${userLevel === undefined ? '—' : Math.floor(userLevel)}`
      + (medalLevel ? ` · ${text(medal?.name) || '粉丝牌'} Lv.${Math.floor(medalLevel)}` : '');

    let body = text(event.message);
    if (kind === 'gift') body = `送出 [${text(event.giftName) || '礼物'}]`;
    if (kind === 'superchat') {
      const amount = number(event.priceNormalized);
      body = `[${amount === null ? '金额未知' : `¥${amountFormat.format(amount)}`}] ${body}`.trim();
    }
    if (!body) return null;

    // Laplace normalizes different upstream timestamp units to milliseconds.
    const normalized = number(event.timestampNormalized);
    const raw = number(event.timestamp);
    let timestamp = normalized && normalized > 0 ? normalized : raw;
    if (timestamp && !normalized) {
      if (timestamp < 1e11) timestamp *= 1000;
      else if (timestamp >= 1e17) timestamp /= 1e6;
      else if (timestamp >= 1e14) timestamp /= 1000;
    }
    if (!timestamp || !Number.isFinite(new Date(timestamp).getTime())) timestamp = receivedAt;

    const id = text(event.stableKey) || text(event.idStr) || text(event.id);
    return {
      key: id ? `${event.origin}:${kind}:${id}` : null,
      kind,
      timestamp,
      username: text(event.username) || '匿名用户',
      level,
      body,
    };
  }
}
