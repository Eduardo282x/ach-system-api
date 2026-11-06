import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

export const APP_TIMEZONE = 'America/Caracas';

export interface ShiftTimeRange {
    startTime: string;
    endTime: string;
}

export const timeToMinutes = (time: string): number => {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
};

/**
 * Minutos transcurridos del dia en la zona horaria de la aplicacion.
 * Se usa para resolver el turno actual sin depender de la zona horaria del servidor.
 */
export const minutesOfDay = (date: Date = new Date()): number => {
    const local = dayjs(date).tz(APP_TIMEZONE);
    return local.hour() * 60 + local.minute();
};

export const startOfDay = (date: string): Date => {
    return dayjs.tz(date, APP_TIMEZONE).startOf('day').toDate();
};

export const endOfDay = (date: string): Date => {
    return dayjs.tz(date, APP_TIMEZONE).endOf('day').toDate();
};

export const parseDateOnly = (date: string): Date => startOfDay(date);

/**
 * Rango exacto de un turno para reportes.
 * Para turnos nocturnos se interpreta que `date` es la fecha en la que termina el turno
 * (misma convencion que usaba el sistema): 22:00 - 06:00 con date = 2026-11-07
 * devuelve 2026-11-06 22:00 -> 2026-11-07 06:00 (hora de Caracas).
 */
export const shiftReportWindow = (date: string, shift: ShiftTimeRange): { start: Date; end: Date } => {
    const startMinutes = timeToMinutes(shift.startTime);
    const endMinutes = timeToMinutes(shift.endTime);
    const [startHour, startMinute] = shift.startTime.split(':').map(Number);
    const [endHour, endMinute] = shift.endTime.split(':').map(Number);

    const base = dayjs.tz(date, APP_TIMEZONE);

    if (endMinutes <= startMinutes) {
        return {
            start: base
                .subtract(1, 'day')
                .hour(startHour)
                .minute(startMinute)
                .second(0)
                .millisecond(0)
                .toDate(),
            end: base
                .hour(endHour)
                .minute(endMinute)
                .second(0)
                .millisecond(0)
                .toDate(),
        };
    }

    return {
        start: base.hour(startHour).minute(startMinute).second(0).millisecond(0).toDate(),
        end: base.hour(endHour).minute(endMinute).second(0).millisecond(0).toDate(),
    };
};

/**
 * Rango de un turno cuando `date` es la fecha en la que inicia el turno.
 */
export const shiftStartWindow = (date: string, shift: ShiftTimeRange): { start: Date; end: Date } => {
    const startMinutes = timeToMinutes(shift.startTime);
    const endMinutes = timeToMinutes(shift.endTime);
    const [startHour, startMinute] = shift.startTime.split(':').map(Number);
    const [endHour, endMinute] = shift.endTime.split(':').map(Number);

    const base = dayjs.tz(date, APP_TIMEZONE);
    const start = base.hour(startHour).minute(startMinute).second(0).millisecond(0);

    const end =
        endMinutes <= startMinutes
            ? start.add(1, 'day').hour(endHour).minute(endMinute).second(0).millisecond(0)
            : base.hour(endHour).minute(endMinute).second(0).millisecond(0);

    return { start: start.toDate(), end: end.toDate() };
};

export const localDateString = (date: Date = new Date()): string => {
    return dayjs(date).tz(APP_TIMEZONE).format('YYYY-MM-DD');
};
