import { instagramAdapter, messengerAdapter } from "./metaMessaging";
import { microsoft365Adapter } from "./microsoft365";
import { tiktokAdapter, linkedinAdapter } from "./gated";
import type { ChannelAdapter, InboxChannel } from "./types";
import { websiteAdapter } from "./website";
import { whatsappAdapter } from "./whatsapp";
import { xAdapter } from "./x";

const adapters: Record<InboxChannel, ChannelAdapter> = {
  website: websiteAdapter,
  microsoft365: microsoft365Adapter,
  whatsapp: whatsappAdapter,
  messenger: messengerAdapter,
  instagram: instagramAdapter,
  x: xAdapter,
  tiktok: tiktokAdapter,
  linkedin: linkedinAdapter,
};

export function getChannelAdapter(channel: InboxChannel): ChannelAdapter {
  return adapters[channel];
}

export function listChannelAdapters(): ChannelAdapter[] {
  return Object.values(adapters);
}

export function inquiryChannelToInbox(channel: string | null | undefined): InboxChannel {
  if (channel === "web_form" || channel === "website") return "website";
  if (channel === "email" || channel === "microsoft365" || channel === "microsoft_graph") return "microsoft365";
  if (channel === "whatsapp") return "whatsapp";
  if (channel === "messenger" || channel === "facebook") return "messenger";
  if (channel === "instagram") return "instagram";
  if (channel === "x" || channel === "twitter") return "x";
  if (channel === "tiktok") return "tiktok";
  if (channel === "linkedin") return "linkedin";
  return "website";
}

export { LINKEDIN_HANDOFF_URL, TIKTOK_HANDOFF_URL } from "./gated";
