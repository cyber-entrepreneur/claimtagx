/**
 * @workspace/first-party-auth — ClaimTagX-owned, brand-neutral authentication core.
 *
 * First-party, framework-agnostic auth platform: hexagonal core (domain →
 * application → ports) with swappable outbound adapters. Owned and maintained
 * by ClaimTagX; see PROVENANCE.md for the one-time vendor origin. This package
 * makes no third-party product claim.
 */

export * as AuthDomain from "./domain/index.js";
export * from "./ports/index.js";
export * from "./application/index.js";
export * from "./adapters/index.js";
export {
  createAuthPlatform,
  type AuthPlatform,
  type AuthPlatformConfig,
} from "./create-auth-platform.js";
