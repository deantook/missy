import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { LLMResult } from "@langchain/core/outputs";

export type TokenUsage = { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null };

export class UsageCollector {
  private input = 0;
  private output = 0;
  private total = 0;
  private seen = false;

  readonly callback = BaseCallbackHandler.fromMethods({
    handleLLMEnd: (result: LLMResult) => {
      for (const batch of result.generations ?? []) {
        for (const generation of batch) {
          const metadata = (generation as { message?: { usage_metadata?: { input_tokens?: number; output_tokens?: number; total_tokens?: number } } }).message?.usage_metadata;
          if (!metadata) continue;
          this.seen = true;
          this.input += metadata.input_tokens ?? 0;
          this.output += metadata.output_tokens ?? 0;
          this.total += metadata.total_tokens ?? (metadata.input_tokens ?? 0) + (metadata.output_tokens ?? 0);
        }
      }
    },
  });

  value(): TokenUsage {
    return this.seen
      ? { inputTokens: this.input, outputTokens: this.output, totalTokens: this.total }
      : { inputTokens: null, outputTokens: null, totalTokens: null };
  }
}
