"use client";
import { OrganizationList } from "@clerk/nextjs";

export default function SelectOrgPage() {
  return (
    <main className="min-h-screen bg-brand-black flex items-center justify-center p-4">
      <OrganizationList
        afterSelectOrganizationUrl="/post-signin"
        hidePersonal
      />
    </main>
  );
}
