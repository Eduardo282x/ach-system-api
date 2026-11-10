-- Add historical cost snapshot to invoice items.
-- unitCost is stored in the product currency; costSubtotal is stored in Bs.
ALTER TABLE "InvoiceItem"
ADD COLUMN IF NOT EXISTS "unitCost" DECIMAL(10, 2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "costSubtotal" DECIMAL(10, 2) NOT NULL DEFAULT 0;

-- Backfill existing rows with the current product purchase price.
-- This is an estimate: the real purchase cost at sale time was not stored before.
UPDATE "InvoiceItem" ii
SET
    "unitCost" = sub."unitCost",
    "costSubtotal" = sub."costSubtotal"
FROM (
    SELECT
        item."id",
        product."purchasePrice" AS "unitCost",
        ROUND(
            item."quantity" * product."purchasePrice" *
            CASE product."currency"
                WHEN 'BS' THEN 1
                WHEN 'USD' THEN usd_rate."rate"
                WHEN 'EUR' THEN eur_rate."rate"
                ELSE 1
            END,
            2
        ) AS "costSubtotal"
    FROM "InvoiceItem" item
    JOIN "Product" product ON product."id" = item."productId"
    JOIN "Invoice" invoice ON invoice."id" = item."invoiceId"
    JOIN "ExchangeRate" usd_rate ON usd_rate."id" = invoice."exchangeRateUsdId"
    JOIN "ExchangeRate" eur_rate ON eur_rate."id" = invoice."exchangeRateEurId"
) sub
WHERE ii."id" = sub."id"
  AND ii."unitCost" = 0
  AND ii."costSubtotal" = 0;
