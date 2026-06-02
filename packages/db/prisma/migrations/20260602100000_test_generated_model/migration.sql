-- AlterTable
-- Records which LLM generated a Test's content (captured from the gateway
-- ChatResponse.model at generation time). Nullable so existing rows and any
-- non-generated rows simply carry NULL.
ALTER TABLE "Test" ADD COLUMN     "generated_model" TEXT;
