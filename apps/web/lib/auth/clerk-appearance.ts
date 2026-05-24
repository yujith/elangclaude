// Brand-aligned appearance for every Clerk component (<ClerkProvider>,
// <SignIn>, <SignUp>, <UserButton>). Keeps colour + typography overrides
// in one place so a brand token change does not drift across surfaces.
// Token values mirror packages/ui/src/tokens.css.
//
// `variables` cascades to every Clerk widget state (sign-in form, sign-up
// form, forgot password, MFA prompt, email verification code, identity
// preview). `elements` overrides the specific Tailwind classes Clerk
// applies on top — listed below in roughly the order the user sees them
// during the sign-in / sign-up flows.
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
    // Card shell
    rootBox: "w-full",
    card: "shadow-none ring-1 ring-brand-grey-200 rounded-lg",
    headerTitle: "font-heading font-bold text-brand-black",
    headerSubtitle: "font-body text-brand-grey-500",

    // Primary CTA (sign-in, sign-up, "Continue", "Verify")
    formButtonPrimary:
      "bg-brand-red hover:bg-brand-red-dark border border-brand-red text-white font-heading font-bold rounded-pill normal-case",
    // Secondary / cancel buttons ("Back", "Use another method")
    formButtonReset:
      "font-body font-medium text-brand-grey-700 hover:text-brand-red",

    // OAuth + alternate-method block buttons
    socialButtonsBlockButton:
      "border border-brand-grey-200 rounded-pill font-heading font-bold text-brand-black hover:bg-brand-grey-50",

    // "or" divider between OAuth and email fields
    dividerLine: "bg-brand-grey-200",
    dividerText: "font-body text-brand-grey-500",

    // Form fields (email, password, name)
    formFieldLabel: "font-body font-medium text-brand-grey-700",
    formFieldInput:
      "rounded-lg border border-brand-grey-200 focus:border-brand-red focus:ring-2 focus:ring-brand-red focus:ring-offset-0",
    formFieldHintText: "font-body text-brand-grey-500 text-sm",
    formFieldErrorText: "font-body text-brand-red text-sm",
    formFieldSuccessText: "font-body text-brand-black text-sm",

    // Verification-code (email code, MFA TOTP) inputs and the "didn't
    // receive a code?" resend link
    otpCodeFieldInput:
      "rounded-lg border border-brand-grey-200 focus:border-brand-red focus:ring-2 focus:ring-brand-red focus:ring-offset-0",
    otpCodeFieldErrorText: "font-body text-brand-red text-sm",
    formResendCodeLink:
      "font-body font-medium text-brand-grey-500 hover:text-brand-red",

    // Banner-style alerts (sign-in errors, expired-link notice)
    alert: "rounded-lg bg-brand-red-soft border border-brand-red/20",
    alertText: "font-body text-brand-black",

    // Identity preview ("you're signing in as ...") + edit button on the
    // verification step
    identityPreviewEditButton: "text-brand-black hover:text-brand-red",

    // "Don't have an account? Sign up" / "Already have an account? Sign in"
    footer: "bg-transparent",
    footerActionLink:
      "text-brand-black hover:text-brand-red font-heading font-bold",
  },
} as const;
