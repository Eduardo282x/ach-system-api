import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { endOfDay, minutesOfDay, startOfDay } from '../src/common/utils/time.util';
import * as fs from 'fs';
import * as path from 'path';

type ShiftRow = {
	id: number;
	name: string;
	startTime: string;
	endTime: string;
};

type InvoiceRow = {
	id: number;
	invoiceNumber: string;
	createdAt: Date;
	status: string;
	sessionId: number | null;
	shiftId: number | null;
	totalAmountBs: unknown;
};

type PlannedChange = InvoiceRow & {
	newShiftId: number | undefined;
	newShiftName: string | undefined;
};

type Options = {
	apply: boolean;
	from?: string;
	to?: string;
	clearUnresolved: boolean;
	includeCancelled: boolean;
	limit?: number;
};

function printHelp() {
	console.log(`
Recalcula el turno (Shift) de las facturas según su hora de creación,
sin depender del turno con el que se abrió la sesión de caja.

Uso:
  node --env-file=.env -r ts-node/register scripts/recalculate-shift-sales.ts [opciones]

Opciones:
  --apply              Aplica los cambios. Sin esta opción solo se muestra el dry-run.
  --date=YYYY-MM-DD    Solo procesa las facturas de ese día (hora Caracas).
  --from=YYYY-MM-DD    Fecha inicial del rango (hora Caracas, inclusive).
  --to=YYYY-MM-DD      Fecha final del rango (hora Caracas, inclusive).
  --include-cancelled  Incluye facturas con status CANCELLED (por defecto se omiten).
  --clear-unresolved   Pone shiftId = NULL cuando ninguna franja horaria cubre la venta.
  --limit=N            Procesa como máximo N facturas (útil para probar).
  --help, -h           Muestra esta ayuda.

Ejemplos:
  pnpm sales:recalc-shifts
  pnpm sales:recalc-shifts -- --date=2026-11-09
  pnpm sales:recalc-shifts:apply -- --date=2026-11-09
`.trim());
}

function parseArgs(argv: string[]): Options {
	const options: Options = {
		apply: false,
		clearUnresolved: false,
		includeCancelled: false,
	};

	for (const rawArg of argv) {
		const arg = rawArg.trim();

		if (!arg || arg === '--') {
			continue;
		}

		if (arg === '--apply') {
			options.apply = true;
			continue;
		}

		if (arg === '--include-cancelled') {
			options.includeCancelled = true;
			continue;
		}

		if (arg === '--clear-unresolved') {
			options.clearUnresolved = true;
			continue;
		}

		if (arg === '--help' || arg === '-h') {
			printHelp();
			process.exit(0);
		}

		if (arg.startsWith('--date=')) {
			const value = arg.slice('--date='.length);
			assertDate(value, 'date');
			options.from = value;
			options.to = value;
			continue;
		}

		if (arg.startsWith('--from=')) {
			const value = arg.slice('--from='.length);
			assertDate(value, 'from');
			options.from = value;
			continue;
		}

		if (arg.startsWith('--to=')) {
			const value = arg.slice('--to='.length);
			assertDate(value, 'to');
			options.to = value;
			continue;
		}

		if (arg.startsWith('--limit=')) {
			const value = Number(arg.slice('--limit='.length));

			if (!Number.isInteger(value) || value <= 0) {
				throw new Error('--limit debe ser un entero mayor a 0');
			}

			options.limit = value;
			continue;
		}

		throw new Error(`Opción no reconocida: ${arg}`);
	}

	if (options.from && options.to && options.from > options.to) {
		throw new Error('--from no puede ser mayor que --to');
	}

	return options;
}

function assertDate(value: string, name: string) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		throw new Error(`--${name} debe tener el formato YYYY-MM-DD (recibido: "${value}")`);
	}

	if (Number.isNaN(startOfDay(value).getTime())) {
		throw new Error(`--${name} no es una fecha válida: "${value}"`);
	}
}

function createPrismaClient() {
	const connectionString = process.env.DATABASE_URL;

	if (!connectionString) {
		throw new Error(
			'DATABASE_URL no está definida. Ejecuta el script con --env-file=.env o define la variable de entorno.',
		);
	}

	const adapter = new PrismaPg({
		connectionString,
		max: 5,
	});

	return new PrismaClient({ adapter });
}

function describeDatabase(connectionString?: string) {
	if (!connectionString) {
		return '(DATABASE_URL no definida)';
	}

	try {
		const url = new URL(connectionString);
		return `${url.hostname}:${url.port || '5432'}${url.pathname}`;
	} catch {
		return '(DATABASE_URL no se pudo interpretar)';
	}
}

function timeToMinutes(time: string): number {
	const [hours, minutes] = time.split(':').map(Number);
	return hours * 60 + minutes;
}

/**
 * Resuelve el turno que cubre un instante dado (hora Caracas).
 * Misma regla que ShiftsService.findCurrentShift, pero considerando también
 * turnos que hoy están inactivos, porque la venta pudo ocurrir cuando sí lo estaban.
 */
function resolveShift(at: Date, shifts: ShiftRow[]): ShiftRow | undefined {
	const currentMinutes = minutesOfDay(at);

	for (const shift of shifts) {
		const startMinutes = timeToMinutes(shift.startTime);
		const endMinutes = timeToMinutes(shift.endTime);

		if (startMinutes <= endMinutes) {
			if (currentMinutes >= startMinutes && currentMinutes < endMinutes) {
				return shift;
			}
			continue;
		}

		if (currentMinutes >= startMinutes || currentMinutes < endMinutes) {
			return shift;
		}
	}

	return undefined;
}

function buildPlan(invoices: InvoiceRow[], shifts: ShiftRow[]): PlannedChange[] {
	if (shifts.length === 0) {
		throw new Error('No hay turnos configurados en la base de datos.');
	}

	return invoices.map((invoice) => {
		const shift = resolveShift(invoice.createdAt, shifts);

		return {
			...invoice,
			newShiftId: shift?.id,
			newShiftName: shift?.name,
		};
	});
}

function formatLocal(date: Date) {
	return new Intl.DateTimeFormat('es-VE', {
		timeZone: 'America/Caracas',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
	}).format(date);
}

function writeBackup(changes: PlannedChange[], options: Options) {
	const backupDir = path.resolve(process.cwd(), 'scripts', 'backups');
	fs.mkdirSync(backupDir, { recursive: true });

	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const filePath = path.join(backupDir, `recalculate-shift-sales-${timestamp}.json`);

	const payload = {
		generatedAt: new Date().toISOString(),
		database: describeDatabase(process.env.DATABASE_URL),
		from: options.from ?? null,
		to: options.to ?? null,
		clearUnresolved: options.clearUnresolved,
		totalChanges: changes.length,
		changes: changes.map((change) => ({
			id: change.id,
			invoiceNumber: change.invoiceNumber,
			createdAt: change.createdAt.toISOString(),
			status: change.status,
			sessionId: change.sessionId,
			oldShiftId: change.shiftId,
			newShiftId: change.newShiftId ?? null,
		})),
	};

	fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');

	return filePath;
}

function printTransitionMatrix(changes: PlannedChange[], shifts: ShiftRow[]) {
	const shiftName = new Map(shifts.map((shift) => [shift.id, shift.name]));
	const label = (id: number | null) => (id === null ? 'SIN TURNO' : (shiftName.get(id) ?? `#${id}`));

	const matrix = new Map<string, { from: string; to: string; count: number }>();

	for (const change of changes) {
		const from = label(change.shiftId);
		const to = label(change.newShiftId ?? null);
		const key = `${from} -> ${to}`;
		const current = matrix.get(key) ?? { from, to, count: 0 };
		current.count += 1;
		matrix.set(key, current);
	}

	const rows = Array.from(matrix.values()).sort((a, b) => b.count - a.count);

	console.log('\nTransiciones (turno actual -> turno calculado):');
	console.log('  Turno actual        -> Turno calculado      Facturas');

	for (const row of rows) {
		console.log(
			`  ${row.from.padEnd(19)} -> ${row.to.padEnd(20)} ${String(row.count).padStart(8)}`,
		);
	}
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const prisma = createPrismaClient();
	const startedAt = Date.now();

	try {
		console.log(`Base de datos: ${describeDatabase(process.env.DATABASE_URL)}`);
		console.log(`Modo: ${options.apply ? 'APLICAR' : 'DRY-RUN (no se escribe nada)'}`);

		const range = options.from && options.to
			? `${options.from} -> ${options.to}`
			: 'todas las fechas';
		console.log(`Rango: ${range}`);
		console.log(`Canceladas: ${options.includeCancelled ? 'incluidas' : 'omitidas'}`);

		const shifts = await prisma.shift.findMany({
			select: { id: true, name: true, startTime: true, endTime: true },
			orderBy: { id: 'asc' },
		});

		if (shifts.length === 0) {
			throw new Error('No hay turnos configurados en la base de datos.');
		}

		console.log('\nTurnos configurados:');

		for (const shift of shifts) {
			console.log(`  #${shift.id} ${shift.name.padEnd(12)} ${shift.startTime} - ${shift.endTime}`);
		}

		const where: Record<string, unknown> = {};

		if (options.from && options.to) {
			where.createdAt = {
				gte: startOfDay(options.from),
				lte: endOfDay(options.to),
			};
		}

		if (!options.includeCancelled) {
			where.status = { not: 'CANCELLED' };
		}

		const invoices = await prisma.invoice.findMany({
			where,
			select: {
				id: true,
				invoiceNumber: true,
				createdAt: true,
				status: true,
				sessionId: true,
				shiftId: true,
				totalAmountBs: true,
			},
			orderBy: { createdAt: 'asc' },
			...(options.limit ? { take: options.limit } : {}),
		});

		if (invoices.length === 0) {
			console.log('\nNo hay facturas en el rango indicado.');
			return;
		}

		const plan = buildPlan(invoices as InvoiceRow[], shifts);
		const pending = plan.filter((change) => (change.newShiftId ?? null) !== change.shiftId);
		const unresolved = plan.filter((change) => change.newShiftId === undefined);

		console.log(`\nFacturas analizadas: ${plan.length}`);
		console.log(`  - Ya tienen el turno correcto: ${plan.length - pending.length}`);
		console.log(`  - Con turno a corregir: ${pending.length}`);
		console.log(`  - Sin franja horaria que las cubra: ${unresolved.length}`);

		printTransitionMatrix(plan, shifts);

		const examples = pending.slice(0, 15);

		if (examples.length > 0) {
			console.log('\nPrimeras facturas a corregir:');

			for (const change of examples) {
				const from = change.shiftId === null ? 'SIN TURNO' : `#${change.shiftId}`;
				const to = change.newShiftId === undefined ? 'SIN TURNO' : `#${change.newShiftId}`;
				console.log(
					`  ${change.invoiceNumber} | ${formatLocal(change.createdAt)} | sesión ${change.sessionId ?? '-'} | ${from} -> ${to} | ${Number(change.totalAmountBs).toFixed(2)} Bs`,
				);
			}

			if (pending.length > examples.length) {
				console.log(`  ... y ${pending.length - examples.length} más`);
			}
		}

		if (unresolved.length > 0 && !options.clearUnresolved) {
			console.log(
				`\nNota: ${unresolved.length} facturas no caen en ninguna franja horaria. Se dejan con su turno actual.`,
			);
			console.log('     Usa --clear-unresolved si quieres dejarlas con shiftId = NULL.');
		}

		const applicable = pending.filter(
			(change) => change.newShiftId !== undefined || options.clearUnresolved,
		);

		if (applicable.length === 0) {
			console.log('\nNo hay cambios por aplicar.');
			return;
		}

		if (!options.apply) {
			console.log('\nDRY-RUN: no se modificó la base de datos.');
			console.log('Ejecuta el script con --apply para aplicar los cambios.');
			return;
		}

		const backupPath = writeBackup(applicable, options);
		console.log(`\nRespaldo generado: ${path.relative(process.cwd(), backupPath)}`);

		const byNewShift = new Map<number | null, number[]>();

		for (const change of applicable) {
			const key = change.newShiftId ?? null;
			const ids = byNewShift.get(key) ?? [];
			ids.push(change.id);
			byNewShift.set(key, ids);
		}

		const chunkSize = 500;

		await prisma.$transaction(
			async (tx) => {
				for (const [shiftId, ids] of byNewShift.entries()) {
					for (let index = 0; index < ids.length; index += chunkSize) {
						const chunk = ids.slice(index, index + chunkSize);

						await tx.invoice.updateMany({
							where: { id: { in: chunk } },
							data: { shiftId },
						});
					}
				}
			},
			{
				maxWait: 15_000,
				timeout: 180_000,
			},
		);

		console.log('\nRecalculo completado.');
		console.log(`  - Facturas actualizadas: ${applicable.length}`);
		console.log(`  - Duración: ${((Date.now() - startedAt) / 1000).toFixed(2)}s`);

		if (options.from && options.to) {
			const [byShift, withoutShift] = await Promise.all([
				prisma.invoice.groupBy({
					by: ['shiftId'],
					where: {
						createdAt: { gte: startOfDay(options.from), lte: endOfDay(options.to) },
						status: { not: 'CANCELLED' },
					},
					_count: { _all: true },
					_sum: { totalAmountBs: true },
				}),
				prisma.invoice.count({
					where: {
						createdAt: { gte: startOfDay(options.from), lte: endOfDay(options.to) },
						status: { not: 'CANCELLED' },
						shiftId: null,
					},
				}),
			]);

			const shiftName = new Map(shifts.map((shift) => [shift.id, shift.name]));

			console.log(`\nDistribución por turno en ${options.from} -> ${options.to}:`);

			for (const row of byShift) {
				const name = row.shiftId === null ? 'SIN TURNO' : (shiftName.get(row.shiftId) ?? `#${row.shiftId}`);
				console.log(
					`  ${name.padEnd(12)} ${String(row._count._all).padStart(5)} facturas | ${Number(row._sum.totalAmountBs ?? 0).toFixed(2)} Bs`,
				);
			}

			if (withoutShift > 0) {
				console.log(`  (${withoutShift} facturas sin turno)`);
			}
		}
	} finally {
		await prisma.$disconnect();
	}
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`\nError: ${message}`);
	process.exitCode = 1;
});
