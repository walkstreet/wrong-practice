import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";

dayjs.extend(utc);

/**
 * Backend stores naive UTC timestamps; convert to local timezone for display.
 */
export function formatDateTimeLocal(value?: string | null): string {
  if (!value) return "--";
  return dayjs.utc(value).local().format("YYYY-MM-DD HH:mm:ss");
}

