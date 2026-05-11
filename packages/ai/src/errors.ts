// Typed errors the gateway throws. Route handlers map these to HTTP codes:
//   QuotaExceededError    → 429
//   ModelNotAllowedError  → 500 (this is a programming error, not user input)
//   ProviderError         → 502 (upstream failure)
//   GradeShapeError       → 502 (provider returned malformed grade JSON)

export class QuotaExceededError extends Error {
  constructor(
    public readonly user_id: string,
    public readonly used: number,
    public readonly limit: number,
  ) {
    super(`Daily AI quota reached (${used}/${limit}). Resets at midnight UTC.`);
    this.name = "QuotaExceededError";
  }
}

export class ModelNotAllowedError extends Error {
  constructor(
    public readonly purpose: string,
    public readonly model: string,
    public readonly allowed: readonly string[],
  ) {
    super(
      `Model "${model}" is not allowed for purpose "${purpose}". Allowed: ${allowed.join(", ")}.`,
    );
    this.name = "ModelNotAllowedError";
  }
}

export class ProviderError extends Error {
  // `cause` flows through the standard Error `cause` option below, so we
  // expose it via the base class rather than a parameter property (which
  // collides with Error.cause under noImplicitOverride).
  constructor(
    public readonly provider: string,
    cause: unknown,
  ) {
    super(`Upstream provider "${provider}" failed: ${describeCause(cause)}`, {
      cause,
    });
    this.name = "ProviderError";
  }
}

export class GradeShapeError extends Error {
  constructor(
    public readonly issues: unknown,
    public readonly raw: string,
  ) {
    super(`Grading response failed schema validation.`);
    this.name = "GradeShapeError";
  }
}

function describeCause(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "string") return cause;
  return "unknown";
}
