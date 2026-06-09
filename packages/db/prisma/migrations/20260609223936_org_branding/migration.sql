-- CreateTable
CREATE TABLE "OrgBranding" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "primary_color" TEXT NOT NULL,
    "surface_dark_color" TEXT NOT NULL,
    "font_key" TEXT NOT NULL,
    "logo_object_key" TEXT,
    "logo_updated_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgBranding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrgBranding_org_id_key" ON "OrgBranding"("org_id");

-- AddForeignKey
ALTER TABLE "OrgBranding" ADD CONSTRAINT "OrgBranding_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
