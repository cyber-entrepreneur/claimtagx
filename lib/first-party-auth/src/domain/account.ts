import type { EpochMillis } from "../shared/clock.js";
import type { AccountId } from "./ids.js";

/**
 * An account is the principal that authenticates. It owns identifiers (the
 * things you log in WITH) and credentials (the things that PROVE it). Profile
 * data beyond identity is a host concern and deliberately absent here.
 */

export type AccountStatus =
  | "pending" // registered, identifier not yet verified
  | "active"
  | "locked" // temporary, e.g. too many failed attempts
  | "disabled"; // permanent, by an admin

/** A normalized login handle. `value` is stored already-normalized (see helpers). */
export interface Identifier {
  readonly kind: "email" | "phone" | "username";
  readonly value: string;
  readonly verified: boolean;
}

export interface Account {
  readonly id: AccountId;
  readonly identifiers: readonly Identifier[];
  readonly status: AccountStatus;
  /** Whether a second factor is required at login for this account. */
  readonly mfaRequired: boolean;
  readonly createdAt: EpochMillis;
  /** Set while `status === "locked"`; account auto-unlocks after this time. */
  readonly lockedUntil?: EpochMillis;
}

export const hasVerifiedIdentifier = (account: Account): boolean =>
  account.identifiers.some((i) => i.verified);

export const findIdentifier = (
  account: Account,
  kind: Identifier["kind"],
  value: string,
): Identifier | undefined =>
  account.identifiers.find((i) => i.kind === kind && i.value === value);

/** Normalization is a domain rule, not a formatting whim — email lowercased,
 *  phone digits-only with country code. Adapters must store the normalized form. */
export const normalizeIdentifier = (kind: Identifier["kind"], raw: string): string => {
  switch (kind) {
    case "email":
      return raw.trim().toLowerCase();
    case "phone":
      return raw.replace(/[^\d+]/g, "");
    case "username":
      return raw.trim().toLowerCase();
  }
};
