import { DateTime } from 'luxon';
import {
  AppointmentEntity,
  AvailabilityExceptionEntity,
  ScheduleEntity,
} from '../database/models';

export interface AvailabilitySlot {
  staffId: string;
  staffName: string;
  startsAt: string;
  endsAt: string;
  localStartsAt: string;
  localEndsAt: string;
  timezone: string;
  durationMinutes: number;
}

interface EligibleStaff {
  id: string;
  name: string;
  durationMinutes: number;
}

interface AvailabilityInput {
  date: string;
  timezone: string;
  eligible: EligibleStaff[];
  schedules: ScheduleEntity[];
  exceptions: AvailabilityExceptionEntity[];
  appointments: AppointmentEntity[];
}

interface Interval {
  startsAt: Date;
  endsAt: Date;
}

const STEP_MILLISECONDS = 15 * 60_000;

export function buildAvailabilitySlots(
  input: AvailabilityInput,
): AvailabilitySlot[] {
  const dayStart = DateTime.fromISO(input.date, {
    zone: input.timezone,
  }).startOf('day');
  const dayEnd = dayStart.plus({ days: 1 });
  const slots = new Map<string, AvailabilitySlot>();

  for (const staff of input.eligible) {
    const working = workingIntervals(input, staff.id, dayStart, dayEnd);
    const unavailable = input.exceptions.filter(
      (item) => item.staffId === staff.id && item.kind === 'UNAVAILABLE',
    );
    const appointments = input.appointments.filter(
      (item) => item.staffId === staff.id,
    );
    const durationMilliseconds = staff.durationMinutes * 60_000;

    for (const interval of working) {
      for (
        let startsAt = interval.startsAt.getTime();
        startsAt + durationMilliseconds <= interval.endsAt.getTime();
        startsAt += STEP_MILLISECONDS
      ) {
        const endsAt = startsAt + durationMilliseconds;
        if (
          unavailable.some((item) =>
            overlaps(startsAt, endsAt, item.startsAt, item.endsAt),
          ) ||
          appointments.some((item) =>
            overlaps(startsAt, endsAt, item.startsAt, item.endsAt),
          )
        ) {
          continue;
        }
        const start = new Date(startsAt);
        const end = new Date(endsAt);
        slots.set(`${staff.id}:${startsAt}`, {
          staffId: staff.id,
          staffName: staff.name,
          startsAt: start.toISOString(),
          endsAt: end.toISOString(),
          localStartsAt: localLabel(start, input.timezone),
          localEndsAt: localLabel(end, input.timezone),
          timezone: input.timezone,
          durationMinutes: staff.durationMinutes,
        });
      }
    }
  }

  return [...slots.values()].sort(
    (left, right) =>
      left.startsAt.localeCompare(right.startsAt) ||
      left.staffName.localeCompare(right.staffName) ||
      left.staffId.localeCompare(right.staffId),
  );
}

function workingIntervals(
  input: AvailabilityInput,
  staffId: string,
  dayStart: DateTime,
  dayEnd: DateTime,
): Interval[] {
  const scheduled = input.schedules
    .filter((item) => item.staffId === staffId)
    .flatMap((item) => {
      const startsAt = localTime(input.date, item.startsAt, input.timezone);
      const endsAt = localTime(input.date, item.endsAt, input.timezone);
      return startsAt && endsAt && startsAt < endsAt
        ? [{ startsAt, endsAt }]
        : [];
    });
  const available = input.exceptions
    .filter((item) => item.staffId === staffId && item.kind === 'AVAILABLE')
    .map((item) => ({
      startsAt: new Date(
        Math.max(item.startsAt.getTime(), dayStart.toMillis()),
      ),
      endsAt: new Date(Math.min(item.endsAt.getTime(), dayEnd.toMillis())),
    }))
    .filter((item) => item.startsAt < item.endsAt);
  return [...scheduled, ...available];
}

function localTime(date: string, time: string, timezone: string): Date | null {
  const input = `${date}T${time}`;
  const value = DateTime.fromISO(input, { zone: timezone, setZone: true });
  return value.isValid && value.toFormat("yyyy-MM-dd'T'HH:mm") === input
    ? value.toJSDate()
    : null;
}

function overlaps(
  startsAt: number,
  endsAt: number,
  otherStartsAt: Date,
  otherEndsAt: Date,
): boolean {
  return otherStartsAt.getTime() < endsAt && otherEndsAt.getTime() > startsAt;
}

function localLabel(value: Date, timezone: string): string {
  return DateTime.fromJSDate(value, { zone: 'utc' })
    .setZone(timezone)
    .toFormat("yyyy-MM-dd'T'HH:mm");
}
