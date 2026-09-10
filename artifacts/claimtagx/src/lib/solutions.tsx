import type { ReactNode } from 'react';
import {
  Camera,
  ClipboardList,
  Clock,
  Droplets,
  FileText,
  KeyRound,
  LifeBuoy,
  Luggage,
  MessageSquare,
  Search,
  Shield,
  Shirt,
  Watch,
  Wrench,
} from 'lucide-react';
import industryValet from '@/assets/industry-valet.png';
import industryLaundry from '@/assets/industry-laundry.png';
import industryLuggage from '@/assets/industry-luggage.png';
import industryRepair from '@/assets/industry-repair.png';

/** Channel ids mapped to solutions.channels.* translation keys */
export type SolutionChannelId = 'qr' | 'nfc' | 'sms' | 'whatsapp' | 'email' | 'ble' | 'push';

/** Structural solution data — copy lives under solutions.{slug}.* i18n keys */
export interface Solution {
  slug: string;
  image: string;
  painIcons: ReactNode[];
  roi: { itemsPerDay: number; daysPerWeek: number };
  channels: SolutionChannelId[];
  /** When set, primary CTA uses solutions.{slug}.primaryCtaLabel */
  primaryCta?: { url: string };
}

export const solutions: Solution[] = [
  {
    slug: 'valet',
    image: industryValet,
    painIcons: [
      <KeyRound className="w-6 h-6 text-lime" />,
      <Camera className="w-6 h-6 text-lime" />,
      <Clock className="w-6 h-6 text-lime" />,
    ],
    roi: { itemsPerDay: 120, daysPerWeek: 6 },
    channels: ['qr', 'nfc', 'sms', 'whatsapp', 'email'],
  },
  {
    slug: 'dry-cleaning',
    image: industryLaundry,
    painIcons: [
      <Shirt className="w-6 h-6 text-lime" />,
      <Camera className="w-6 h-6 text-lime" />,
      <Search className="w-6 h-6 text-lime" />,
    ],
    roi: { itemsPerDay: 60, daysPerWeek: 6 },
    channels: ['qr', 'sms', 'whatsapp', 'email'],
  },
  {
    slug: 'luggage',
    image: industryLuggage,
    painIcons: [
      <Luggage className="w-6 h-6 text-lime" />,
      <Shield className="w-6 h-6 text-lime" />,
      <Clock className="w-6 h-6 text-lime" />,
    ],
    roi: { itemsPerDay: 100, daysPerWeek: 7 },
    channels: ['qr', 'nfc', 'ble', 'whatsapp', 'email'],
  },
  {
    slug: 'repair',
    image: industryRepair,
    painIcons: [
      <Wrench className="w-6 h-6 text-lime" />,
      <FileText className="w-6 h-6 text-lime" />,
      <MessageSquare className="w-6 h-6 text-lime" />,
    ],
    roi: { itemsPerDay: 25, daysPerWeek: 6 },
    channels: ['qr', 'sms', 'email', 'push'],
  },
  {
    slug: 'hotels',
    image: industryValet,
    painIcons: [
      <ClipboardList className="w-6 h-6 text-lime" />,
      <Clock className="w-6 h-6 text-lime" />,
      <Shield className="w-6 h-6 text-lime" />,
    ],
    roi: { itemsPerDay: 150, daysPerWeek: 7 },
    channels: ['qr', 'nfc', 'sms', 'whatsapp', 'email'],
  },
  {
    slug: 'airlines',
    image: industryLuggage,
    painIcons: [
      <Search className="w-6 h-6 text-lime" />,
      <Camera className="w-6 h-6 text-lime" />,
      <Clock className="w-6 h-6 text-lime" />,
    ],
    roi: { itemsPerDay: 400, daysPerWeek: 7 },
    channels: ['qr', 'nfc', 'ble', 'email', 'push'],
    primaryCta: { url: 'mailto:sales@claimtagx.com' },
  },
  {
    slug: 'clubs-restaurants',
    image: industryValet,
    painIcons: [
      <Clock className="w-6 h-6 text-lime" />,
      <Search className="w-6 h-6 text-lime" />,
      <Shield className="w-6 h-6 text-lime" />,
    ],
    roi: { itemsPerDay: 120, daysPerWeek: 5 },
    channels: ['qr', 'sms', 'whatsapp', 'nfc'],
  },
  {
    slug: 'beach-clubs',
    image: industryLuggage,
    painIcons: [
      <Droplets className="w-6 h-6 text-lime" />,
      <Watch className="w-6 h-6 text-lime" />,
      <LifeBuoy className="w-6 h-6 text-lime" />,
    ],
    roi: { itemsPerDay: 100, daysPerWeek: 7 },
    channels: ['qr', 'nfc', 'whatsapp', 'email'],
  },
];

export function getSolution(slug: string): Solution | undefined {
  return solutions.find((s) => s.slug === slug);
}
