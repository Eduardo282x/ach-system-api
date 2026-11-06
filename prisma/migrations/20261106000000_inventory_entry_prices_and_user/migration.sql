-- Precio de compra del producto (precio de venta sigue en "price")
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "purchasePrice" DECIMAL(10, 2) NOT NULL DEFAULT 0;

-- Entradas de inventario
CREATE TABLE IF NOT EXISTS "InventoryEntry" (
    "id" SERIAL NOT NULL,
    "controlNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "date" TIMESTAMP(3) NOT NULL,
    "userId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryEntry_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "InventoryEntry" ADD COLUMN IF NOT EXISTS "userId" INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS "InventoryEntry_controlNumber_key" ON "InventoryEntry"("controlNumber");
CREATE INDEX IF NOT EXISTS "InventoryEntry_userId_idx" ON "InventoryEntry"("userId");

CREATE TABLE IF NOT EXISTS "InventoryEntryDetail" (
    "id" SERIAL NOT NULL,
    "inventoryEntryId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "quantity" DECIMAL(10, 3) NOT NULL,
    "unitPrice" DECIMAL(10, 2) NOT NULL,
    "salePrice" DECIMAL(10, 2),
    "subtotal" DECIMAL(10, 2) NOT NULL,

    CONSTRAINT "InventoryEntryDetail_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "InventoryEntryDetail" ADD COLUMN IF NOT EXISTS "salePrice" DECIMAL(10, 2);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'InventoryEntry_userId_fkey'
    ) THEN
        ALTER TABLE "InventoryEntry"
            ADD CONSTRAINT "InventoryEntry_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "Users"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'InventoryEntryDetail_inventoryEntryId_fkey'
    ) THEN
        ALTER TABLE "InventoryEntryDetail"
            ADD CONSTRAINT "InventoryEntryDetail_inventoryEntryId_fkey"
            FOREIGN KEY ("inventoryEntryId") REFERENCES "InventoryEntry"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'InventoryEntryDetail_productId_fkey'
    ) THEN
        ALTER TABLE "InventoryEntryDetail"
            ADD CONSTRAINT "InventoryEntryDetail_productId_fkey"
            FOREIGN KEY ("productId") REFERENCES "Product"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;
