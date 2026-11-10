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

También acepta la fecha como argumento posicional: scripts/... 2026-11-09

Nota sobre npm: npm descarta flags sueltos como --apply y convierte --clave=valor
en variables npm_config_*. Por eso, con npm usa el script dedicado o las variables
de entorno:
  npm run sales:recalc-shifts:apply -- --date=2026-11-09
  $env:SHIFT_RECALC_APPLY="true"; npm run sales:recalc-shifts -- --date=2026-11-09

Con pnpm o node directo, --apply funciona normal.

Ejemplos:
  pnpm sales:recalc-shifts
  pnpm sales:recalc-shifts -- --date=2026-11-09
  pnpm sales:recalc-shifts:apply -- --date=2026-11-09
  node --env-file=.env -r ts-node/register scripts/recalculate-shift-sales.ts --apply --date=2026-11-09
`.trim());
}

function isTruthy(value?: string) {
	return value !== undefined && ['true', '1', 'yes', 'si', 'sí'].includes(value.toLowerCase());
}

function readEnvConfig(): Partial<Options> {
	const config: Partial<Options> = {};
	const env = process.env;

	if (isTruthy(env.SHIFT_RECALC_APPLY)) {
		config.apply = true;
	}

	if (env.SHIFT_RECALC_DATE) {
		config.from = env.SHIFT_RECALC_DATE;
		config.to = env.SHIFT_RECALC_DATE;
	}

	if (env.SHIFT_RECALC_FROM) {
		config.from = env.SHIFT_RECALC_FROM;
	}

	if (env.SHIFT_RECALC_TO) {
		config.to = env.SHIFT_RECALC_TO;
	}

	if (env.SHIFT_RECALC_LIMIT) {
		config.limit = Number(env.SHIFT_RECALC_LIMIT);
	}

	if (isTruthy(env.SHIFT_RECALC_CLEAR_UNRESOLVED)) {
		config.clearUnresolved = true;
	}

	if (isTruthy(env.SHIFT_RECALC_INCLUDE_CANCELLED)) {
		config.includeCancelled = true;
	}

	return config;
}

function readNpmConfig(): Partial<Options> {
	const config: Partial<Options> = {};
	const env = process.env;

	if (isTruthy(env.npm_config_apply)) {
		config.apply = true;
	}

	if (isTruthy(env.npm_config_include_cancelled)) {
		config.includeCancelled = true;
	}

	if (isTruthy(env.npm_config_clear_unresolved)) {
		config.clearUnresolved = true;
	}

	if (env.npm_config_date) {
		config.from = env.npm_config_date;
		config.to = env.npm_config_date;
	}

	if (env.npm_config_from) {
		config.from = env.npm_config_from;
	}

	if (env.npm_config_to) {
		config.to = env.npm_config_to;
	}

	if (env.npm_config_limit) {
		config.limit = Number(env.npm_config_limit);
	}

	return config;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseArgs(argv: string[]): Options {
	const options: Options = {
		apply: false,
		clearUnresolved: false,
		includeCancelled: false,
		...readNpmConfig(),
		...readEnvConfig(),
	};

	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index].trim();

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

		if (DATE_PATTERN.test(arg)) {
			options.from = arg;
			options.to = arg;
			continue;
		}

		if (arg === '--date') {
			const value = argv[++index];
			assertDate(value, 'date');
			options.from = value;
			options.to = value;
			continue;
		}

		if (arg.startsWith('--date=')) {
			const value = arg.slice('--date='.length);
			assertDate(value, 'date');
			options.from = value;
			options.to = value;
			continue;
		}

		if (arg === '--from') {
			const value = argv[++index];
			assertDate(value, 'from');
			options.from = value;
			continue;
		}

		if (arg.startsWith('--from=')) {
			const value = arg.slice('--from='.length);
			assertDate(value, 'from');
			options.from = value;
			continue;
		}

		if (arg === '--to') {
			const value = argv[++index];
			assertDate(value, 'to');
			options.to = value;
			continue;
		}

		if (arg.startsWith('--to=')) {
			const value = arg.slice('--to='.length);
			assertDate(value, 'to');
			options.to = value;
			continue;
		}

		if (arg === '--limit') {
			options.limit = parseLimit(argv[++index]);
			continue;
		}

		if (arg.startsWith('--limit=')) {
			options.limit = parseLimit(arg.slice('--limit='.length));
			continue;
		}

		throw new Error(`Opción no reconocida: ${arg}`);
	}

	if (options.from) {
		assertDate(options.from, 'from');
	}

	if (options.to) {
		assertDate(options.to, 'to');
	}

	if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit <= 0)) {
		throw new Error('--limit debe ser un entero mayor a 0');
	}

	if (options.from && options.to && options.from > options.to) {
		throw new Error('--from no puede ser mayor que --to');
	}

	return options;
}

function parseLimit(value: string | undefined) {
	const parsed = Number(value);

	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new Error('--limit debe ser un entero mayor a 0');
	}

	return parsed;
}

function assertDate(value: string | undefined, name: string) {
	if (!value || !DATE_PATTERN.test(value)) {
		throw new Error(`--${name} debe tener el formato YYYY-MM-DD (recibido: "${value ?? ''}")`);
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
			console.log('Para aplicar los cambios:');
			console.log('  pnpm sales:recalc-shifts:apply');
			console.log('  npm run sales:recalc-shifts:apply');
			console.log('  $env:SHIFT_RECALC_APPLY="true"; npm run sales:recalc-shifts');
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
