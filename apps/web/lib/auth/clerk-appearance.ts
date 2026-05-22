// Brand-aligned appearance for every Clerk component (<ClerkProvider>,
// <SignIn>, <SignUp>, <UserButton>). Keeps colour + typography overrides
// in one place so a brand token change does not drift across surfaces.
// Token values mirror packages/ui/src/tokens.css.
//
// Returned as `const` (not typed as Appearance) so ClerkProvider's own
// prop type validates the shape at the call site — Clerk's `Appearance`
// is `any` in v7's @clerk/shared/types anyway.

export const clerkAppearance = {
  variables: {
    colorPrimary: "#EE2346",
    colorDanger: "#EE2346",
    colorText: "#0A0A0A",
    colorTextSecondary: "#737373",
    colorBackground: "#FFFFFF",
    colorInputBackground: "#FFFFFF",
    colorInputText: "#0A0A0A",
    colorNeutral: "#0A0A0A",
    fontFamily: "Rubik, system-ui, sans-serif",
    fontFamilyButtons: "Rubik, system-ui, sans-serif",
    fontSize: "1rem",
    borderRadius: "0.5rem",
  },
  elements: {
    rootBox: "w-full",
    card: "shadow-none ring-1 ring-brand-grey-200 rounded-lg",
    headerTitle: "font-heading font-bold text-brand-black",
    headerSubtitle: "font-body text-brand-grey-500",
    formButtonPrimary:
      "bg-brand-red hover:bg-brand-red-dark border border-brand-red text-white font-heading font-bold rounded-pill normal-case",
    socialButtonsBlockButton:
      "border border-brand-grey-200 rounded-pill font-heading font-bold text-brand-black hover:bg-brand-grey-50",
    formFieldInput:
      "rounded-lg border border-brand-grey-200 focus:border-brand-red focus:ring-2 focus:ring-brand-red focus:ring-offset-0",
    footerActionLink: "text-brand-black hover:text-brand-red font-heading font-bold",
    identityPreviewEditButton: "text-brand-black hover:text-brand-red",
  },
} as const;
