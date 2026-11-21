import {
  Activity, Bell, BookOpen, Bot, Brain, Briefcase, Building2, Calendar, Camera, Car, ChartColumn, ChartLine, Clock, Code,
  Coffee, CreditCard, FileText, Film, Flag, Folder, Gamepad2, Gift, Globe, GraduationCap, Heart, House, Landmark, Leaf,
  Lightbulb, Link2, ListChecks, Mail, MapPin, Moon, Music, Newspaper, Package, Palette, Phone, PiggyBank, Pill, Plane,
  Receipt, Rocket, Shield, ShoppingCart, Sparkles, Star, Stethoscope, Sun, Tag, Target, Trophy, Users, Utensils, Wallet,
  Dumbbell, Zap, FileText as Note, Gauge, History, Link2 as Links, Table2, LayoutDashboard, type LucideIcon, NotebookPen, Columns3, CalendarCheck, Hourglass } from 'lucide-react';
import type { SlateKind } from '@/lib/kinds';
import type { IconName } from '@/lib/icons';

export const ICONS: Record<IconName, LucideIcon> = {
  wallet: Wallet, 'credit-card': CreditCard, bank: Landmark, receipt: Receipt, 'piggy-bank': PiggyBank,
  'chart-bar': ChartColumn, 'chart-line': ChartLine, target: Target, briefcase: Briefcase, building: Building2,
  package: Package, code: Code, bot: Bot, idea: Lightbulb, rocket: Rocket, bolt: Zap, calendar: Calendar, clock: Clock,
  bell: Bell, checklist: ListChecks, flag: Flag, trophy: Trophy, star: Star, sparkles: Sparkles, home: House,
  cart: ShoppingCart, food: Utensils, coffee: Coffee, gift: Gift, tag: Tag, car: Car, plane: Plane, globe: Globe,
  'map-pin': MapPin, heart: Heart, health: Stethoscope, pill: Pill, dumbbell: Dumbbell, activity: Activity,
  brain: Brain, leaf: Leaf, sun: Sun, moon: Moon, book: BookOpen, graduation: GraduationCap, news: Newspaper,
  file: FileText, folder: Folder, link: Link2, mail: Mail, phone: Phone, people: Users, music: Music, film: Film,
  camera: Camera, game: Gamepad2, palette: Palette, shield: Shield,
};

const KIND_ICON: Record<SlateKind, LucideIcon> = {
  brief: Sun, list: ListChecks, links: Links, metrics: Gauge, timeline: History, table: Table2, markdown: Note, notes: NotebookPen, chart: ChartColumn, dashboard: LayoutDashboard,
  tracker: Columns3, habits: CalendarCheck, goals: Target, countdown: Hourglass,
};

/** A board's chosen icon, or its kind's glyph. Unknown names fall back safely. */
export function BoardIcon({ name, kind, className = 'size-4' }: { name: string | null | undefined; kind: SlateKind; className?: string }) {
  const Icon = (name && ICONS[name as IconName]) || KIND_ICON[kind];
  return <Icon className={className} strokeWidth={1.8} aria-hidden />;
}
