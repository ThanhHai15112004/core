import { MAX_TRACKED_CHANNELS } from '../constants/messaging.keys.js';

/** Tên channel được đếm riêng (giới hạn số lượng để metric không phình). */
export class ChannelTracker {
  private readonly known = new Set<string>();

  public track(channel: string): string {
    if (this.known.has(channel)) return channel;
    if (this.known.size >= MAX_TRACKED_CHANNELS) return '(other)';
    this.known.add(channel);
    return channel;
  }
}
