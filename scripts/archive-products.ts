import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const SUFFIX_BY_NAME = {
    deleted: '-deleted',
    old: '-old',
} as const;

type SuffixName = keyof typeof SUFFIX_BY_NAME;

type ProductRow = {
    id: number;
    name: string;
    barcode: string;
    stock: string;
    deleted: boolean;
};

type PlannedChange = ProductRow & {
    newBarcode: string;
};

type Options = {
    apply: boolean;
    suffixName: SuffixName;
    suffix: string;
    resetStock: boolean;
    onlyActive: boolean;
};

function printHelp() {
    console.log(`
Archiva (borrado lógico) los productos actuales y libera sus códigos de barras.

Uso:
  node --env-file=.env -r ts-node/register scripts/archive-products.ts [opciones]

Opciones:
  --apply          Aplica los cambios. Sin esta opción solo se muestra el dry-run.
  --suffix=NAME    Sufijo a usar: "deleted" (por defecto) u "old".
  --reset-stock    Además de archivar, deja el stock de los productos en 0.
  --only-active    Solo archiva productos con deleted = false.
  --help, -h       Muestra esta ayuda.

Ejemplos:
  pnpm products:archive
  pnpm products:archive:apply
  pnpm run products:archive -- --suffix=old
`.trim());
}

function parseArgs(argv: string[]): Options {
    const options: Options = {
        apply: false,
        suffixName: 'deleted',
        suffix: SUFFIX_BY_NAME.deleted,
        resetStock: false,
        onlyActive: false,
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

        if (arg === '--reset-stock') {
            options.resetStock = true;
            continue;
        }

        if (arg === '--only-active') {
            options.onlyActive = true;
            continue;
        }

        if (arg === '--help' || arg === '-h') {
            printHelp();
            process.exit(0);
        }

        if (arg.startsWith('--suffix=')) {
            const value = arg
                .slice('--suffix='.length)
                .replace(/^-+/, '')
                .toLowerCase();

            if (!(value in SUFFIX_BY_NAME)) {
                throw new Error(`Sufijo no válido: "${value}". Usa "deleted" u "old".`);
            }

            options.suffixName = value as SuffixName;
            options.suffix = SUFFIX_BY_NAME[options.suffixName];
            continue;
        }

        throw new Error(`Opción no reconocida: ${arg}`);
    }

    return options;
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

function buildPlan(products: ProductRow[], suffix: string): PlannedChange[] {
    const usedBarcodes = new Set(products.map((product) => product.barcode));
    const changes: PlannedChange[] = [];

    for (const product of products) {
        let newBarcode = product.barcode;

        if (!newBarcode.endsWith(suffix)) {
            const base = `${newBarcode}${suffix}`;
            newBarcode = base;
            let counter = 2;

            while (usedBarcodes.has(newBarcode)) {
                newBarcode = `${base}-${counter}`;
                counter++;
            }

            usedBarcodes.add(newBarcode);
        }

        changes.push({
            ...product,
            newBarcode,
        });
    }

    return changes;
}

function writeBackup(changes: PlannedChange[], options: Options) {
    const backupDir = path.resolve(process.cwd(), 'scripts', 'backups');
    fs.mkdirSync(backupDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = path.join(backupDir, `products-archive-${timestamp}.json`);

    const payload = {
        generatedAt: new Date().toISOString(),
        database: describeDatabase(process.env.DATABASE_URL),
        suffix: options.suffix,
        resetStock: options.resetStock,
        totalProducts: changes.length,
        products: changes.map((change) => ({
            id: change.id,
            name: change.name,
            oldBarcode: change.barcode,
            newBarcode: change.newBarcode,
            deletedBefore: change.deleted,
            stock: change.stock,
        })),
    };

    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');

    return filePath;
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const prisma = createPrismaClient();
    const startedAt = Date.now();

    try {
        console.log(`Base de datos: ${describeDatabase(process.env.DATABASE_URL)}`);
        console.log(`Sufijo: ${options.suffix}`);
        console.log(`Modo: ${options.apply ? 'APLICAR' : 'DRY-RUN (no se escribe nada)'}`);
        console.log(`Alcance: ${options.onlyActive ? 'solo productos activos' : 'todos los productos'}`);

        const products = await prisma.product.findMany({
            where: options.onlyActive ? { deleted: false } : undefined,
            select: {
                id: true,
                name: true,
                barcode: true,
                stock: true,
                deleted: true,
            },
            orderBy: {
                id: 'asc',
            },
        });

        if (products.length === 0) {
            console.log('\nNo hay productos para archivar.');
            return;
        }

        const rows: ProductRow[] = products.map((product) => ({
            id: product.id,
            name: product.name,
            barcode: product.barcode,
            stock: String(product.stock),
            deleted: product.deleted,
        }));

        const changes = buildPlan(rows, options.suffix);
        const renamed = changes.filter((change) => change.barcode !== change.newBarcode).length;
        const alreadyDeleted = changes.filter((change) => change.deleted).length;
        const needsUpdate = changes.some(
            (change) => change.barcode !== change.newBarcode || !change.deleted,
        );

        console.log(`\nProductos encontrados: ${changes.length}`);
        console.log(`  - Activos: ${changes.length - alreadyDeleted}`);
        console.log(`  - Ya eliminados: ${alreadyDeleted}`);
        console.log(`  - Códigos a renombrar: ${renamed}`);
        console.log(`  - Códigos que ya tienen el sufijo: ${changes.length - renamed}`);

        const examples = changes
            .filter((change) => change.barcode !== change.newBarcode)
            .slice(0, 10);

        if (examples.length > 0) {
            console.log('\nEjemplos:');

            for (const change of examples) {
                console.log(
                    `  ${change.id} | ${change.name} | ${change.barcode} -> ${change.newBarcode}`,
                );
            }

            if (renamed > examples.length) {
                console.log(`  ... y ${renamed - examples.length} más`);
            }
        }

        if (!needsUpdate) {
            console.log('\nTodos los productos ya están archivados. No hay cambios por aplicar.');
            return;
        }

        if (!options.apply) {
            console.log('\nDRY-RUN: no se modificó la base de datos.');
            console.log('Ejecuta el script con --apply para aplicar los cambios.');
            return;
        }

        const backupPath = writeBackup(changes, options);
        console.log(`\nRespaldo generado: ${path.relative(process.cwd(), backupPath)}`);

        await prisma.$transaction(
            async (tx) => {
                for (const change of changes) {
                    const data: {
                        barcode: string;
                        deleted: boolean;
                        stock?: number;
                    } = {
                        barcode: change.newBarcode,
                        deleted: true,
                    };

                    if (options.resetStock) {
                        data.stock = 0;
                    }

                    await tx.product.update({
                        where: { id: change.id },
                        data,
                    });
                }
            },
            {
                maxWait: 15_000,
                timeout: 180_000,
            },
        );

        const [activeRemaining, withoutSuffix] = await Promise.all([
            prisma.product.count({ where: { deleted: false } }),
            prisma.product.count({
                where: {
                    barcode: {
                        not: {
                            endsWith: options.suffix,
                        },
                    },
                },
            }),
        ]);

        console.log('\nArchivo completado.');
        console.log(`  - Productos actualizados: ${changes.length}`);
        console.log(`  - Productos activos restantes: ${activeRemaining}`);
        console.log(`  - Productos sin el sufijo ${options.suffix}: ${withoutSuffix}`);
        console.log(`  - Duración: ${((Date.now() - startedAt) / 1000).toFixed(2)}s`);

        if (activeRemaining > 0) {
            console.warn('  Advertencia: todavía hay productos activos. Revisa la base de datos.');
        }

        if (!options.onlyActive && withoutSuffix > 0) {
            console.warn(
                `  Advertencia: hay productos cuyo código no termina en ${options.suffix}.`,
            );
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
