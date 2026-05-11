// The AI gateway.
//
// Rule, no exceptions: every LLM call in the app goes through `ai.chat()`.
// The gateway enforces:
//   1. Purpose → allowed-models allowlist (cost discipline)
//   2. Per-user daily quota (atomic reserve + refund-on-failure)
//   3. Provider routing (anthropic now, openrouter in Phase 5)
//
// Tests inject `providers` and `db`. Production callers use the default
// `ai` export which wires the real Anthropic adapter and `withOrg(ctx)`.

import { withOrg, type OrgContext } from "@elc/db";
import { anthropicProvider, type Provider, type ProviderMessage } from "./adapters/anthropic";
import { ModelNotAllowedError } from "./errors";
import {
  allowedModelsFor,
  isModelAllowed,
  resolveModel,
  type Purpose,
} from "./models";
import { refundQuota, reserveQuota, type QuotaDb } from "./quota";

export type ChatRequest = {
  ctx: OrgContext;
  purpose: Purpose;
  // Optional override. If omitted, the gateway uses the purpose default.
  // If supplied and not on the purpose allowlist, throws ModelNotAllowedError.
  model?: string;
  messages: ProviderMessage[];
  system?: string;
  maxTokens: number;
};

export type ChatResponse = {
  text: string;
  usage: { input_tokens: number; output_tokens: number };
  model: string;
};

export type GatewayDeps = {
  providers: Record<"anthropic" | "openrouter", Provider>;
  // Returns a Prisma-shaped client scoped to ctx (typically `withOrg(ctx)`).
  // Injected so tests can pass a mock that doesn't talk to a real DB.
  db: (ctx: OrgContext) => QuotaDb;
};

export function createAI(deps: GatewayDeps) {
  return {
    async chat(req: ChatRequest): Promise<ChatResponse> {
      // 1. Allowlist check. If the caller passed a model, it must be on
      //    the purpose's allowlist. If they didn't, we use the default —
      //    which is always on the allowlist by construction (see models.ts).
      if (req.model && !isModelAllowed(req.purpose, req.model)) {
        throw new ModelNotAllowedError(
          req.purpose,
          req.model,
          allowedModelsFor(req.purpose),
        );
      }
      const model = resolveModel(req.purpose, req.model);
      if (!isModelAllowed(req.purpose, model.id)) {
        // The purpose has no allowed models (e.g. generation purposes in
        // Phase 1). Better to fail loudly than to silently call a default
        // that no one approved.
        throw new ModelNotAllowedError(
          req.purpose,
          model.id,
          allowedModelsFor(req.purpose),
        );
      }

      const provider = deps.providers[model.provider];
      const db = deps.db(req.ctx);

      // 2. Reserve quota BEFORE calling the provider. If the call fails,
      //    refund. If the call succeeds, the reservation is the accounting.
      await reserveQuota(db, req.ctx);

      try {
        const res = await provider({
          model: model.id,
          messages: req.messages,
          system: req.system,
          maxTokens: req.maxTokens,
        });
        return { text: res.text, usage: res.usage, model: model.id };
      } catch (err) {
        await refundQuota(db, req.ctx);
        throw err;
      }
    },
  };
}

// Production export. Wires real Anthropic + the org-scoped Prisma client.
// Routes import `ai` and call `ai.chat(...)`.

export const ai = createAI({
  providers: {
    anthropic: anthropicProvider,
    // Placeholder until the OpenRouter adapter lands in Phase 5. The model
    // registry currently routes nothing here, so this is unreachable.
    openrouter: () => {
      throw new Error("OpenRouter adapter not wired yet (Phase 5).");
    },
  },
  db: (ctx) => withOrg(ctx) as unknown as QuotaDb,
});
