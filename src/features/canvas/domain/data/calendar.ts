/**
 * Calendar year 2025 in Meridia: day and hour indices, their strings, weekdays,
 * holidays and seasons. Local time, no timezone. Southern hemisphere: summer is
 * December to February.
 */
import { STORY } from "./story";

export const DAYS = 365;
export const HOURS = DAYS * 24;
const EPOCH_MS = Date.UTC(2025, 0, 1);
const DAY_MS = 86_400_000;

/** "YYYY-MM-DD HH:MM:SS" for minutes since 2025-01-01 00:00 (may run into 2026). */
export function timestampAt(minutes: number): string {
  const iso = new Date(EPOCH_MS + minutes * 60_000).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
}

/** Minutes since 2025-01-01 00:00 of a "YYYY-MM-DD HH:MM:SS" or "YYYY-MM-DD". */
export function minutesOf(text: string): number {
  const [date, time = "00:00:00"] = text.split(" ");
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return (Date.UTC(y, m - 1, d, hh, mm) - EPOCH_MS) / 60_000;
}

/** Index 0..364 of a 2025 date "YYYY-MM-DD". */
export function dayIndex(date: string): number {
  return Math.round(minutesOf(date) / 1440);
}

let dateStrings: string[] | null = null;
let hourStrings: string[] | null = null;

export function dateString(day: number): string {
  if (!dateStrings) {
    dateStrings = Array.from({ length: DAYS }, (_, d) =>
      new Date(EPOCH_MS + d * DAY_MS).toISOString().slice(0, 10),
    );
  }
  return dateStrings[day];
}

/** "YYYY-MM-DD HH:00:00" of hour 0..8759. */
export function hourString(hour: number): string {
  if (!hourStrings) {
    hourStrings = Array.from(
      { length: HOURS },
      (_, h) =>
        `${dateString(Math.floor(h / 24))} ${String(h % 24).padStart(2, "0")}:00:00`,
    );
  }
  return hourStrings[hour];
}

/** 0 = Sunday ... 6 = Saturday. 2025-01-01 is a Wednesday. */
export function weekday(day: number): number {
  return (3 + day) % 7;
}

/** 1..12 */
export function monthOf(day: number): number {
  return Number(dateString(day).slice(5, 7));
}

/** 1..31 */
export function dayOfMonth(day: number): number {
  return Number(dateString(day).slice(8, 10));
}

export function daysInMonth(month: number): number {
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

const HOLIDAY_DAYS = new Set(STORY.holidays.map((h) => dayIndex(h.date)));

export function isHoliday(day: number): boolean {
  return HOLIDAY_DAYS.has(day);
}

/** Saturday, Sunday or a public holiday. */
export function isRestDay(day: number): boolean {
  const w = weekday(day);
  return w === 0 || w === 6 || HOLIDAY_DAYS.has(day);
}

/** +1 in mid-summer (20 January) to -1 in mid-winter (21 July). */
export function summerness(day: number): number {
  return Math.cos((2 * Math.PI * (day - 19)) / 365);
}

/** 0 in mid-summer to 1 in mid-winter. */
export function winterness(day: number): number {
  return (1 - summerness(day)) / 2;
}

export function inRange(day: number, start: string, end: string): boolean {
  return day >= dayIndex(start) && day <= dayIndex(end);
}
