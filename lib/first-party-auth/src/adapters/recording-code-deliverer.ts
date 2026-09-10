import type { DeliveryChannel, ChallengePurpose } from "../domain/verification.js";
import type { CodeDeliverer } from "../ports/outbound.js";

export interface RecordedCode {
  readonly channel: DeliveryChannel;
  readonly destination: string;
  readonly code: string;
  readonly purpose: ChallengePurpose;
}

/** CodeDeliverer that records delivered codes for tests and local development. */
export class RecordingCodeDeliverer implements CodeDeliverer {
  private readonly delivered: RecordedCode[] = [];

  get codes(): readonly RecordedCode[] {
    return this.delivered;
  }

  get lastCode(): RecordedCode | undefined {
    return this.delivered.at(-1);
  }

  async deliver(params: {
    readonly channel: DeliveryChannel;
    readonly destination: string;
    readonly code: string;
    readonly purpose: ChallengePurpose;
  }): Promise<void> {
    this.delivered.push({
      channel: params.channel,
      destination: params.destination,
      code: params.code,
      purpose: params.purpose,
    });
  }
}
