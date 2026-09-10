/// <reference types="node" />
import type { SocialProvider } from "../domain/credential.js";
import type { OAuthClient, SocialProfile } from "../ports/outbound.js";

/** Fake OAuth client for tests and local development. */
export class FakeOAuthClient implements OAuthClient {
  private readonly profiles: ReadonlyMap<string, SocialProfile>;

  constructor(profiles?: ReadonlyMap<string, SocialProfile> | Record<string, SocialProfile>) {
    if (profiles instanceof Map) {
      this.profiles = profiles;
    } else if (profiles !== undefined) {
      this.profiles = new Map(Object.entries(profiles));
    } else {
      this.profiles = new Map();
    }
  }

  authorizationUrl(params: {
    readonly provider: SocialProvider;
    readonly state: string;
    readonly redirectUri: string;
  }): string {
    const query = new URLSearchParams({
      state: params.state,
      redirect_uri: params.redirectUri,
    });
    return `https://oauth.test/${params.provider}?${query.toString()}`;
  }

  async exchangeCode(params: {
    readonly provider: SocialProvider;
    readonly code: string;
    readonly redirectUri: string;
  }): Promise<SocialProfile> {
    const profileKey = `${params.provider}:${params.code}`;
    const configured = this.profiles.get(profileKey) ?? this.profiles.get(params.code);
    if (configured !== undefined) {
      return configured;
    }
    return {
      provider: params.provider,
      subject: `fake-${params.provider}-sub`,
    };
  }
}
