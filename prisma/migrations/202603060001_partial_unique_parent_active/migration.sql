DROP INDEX IF EXISTS "Product_parentId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "Product_parentId_unique_active_idx"
ON "Product" ("parentId")
WHERE "deleted" = false AND "parentId" IS NOT NULL;
