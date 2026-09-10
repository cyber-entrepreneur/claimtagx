/**
 * Branded identifier primitives. Compile-time-only tags over plain strings, so
 * the type system refuses to mix (e.g.) an `AccountId` with a `SessionId`.
 * No branding/product concepts here — only structural identity.
 */

declare const brand: unique symbol;

export type Brand<T, TBrand extends string> = T & { readonly [brand]: TBrand };

export type Id<TBrand extends string> = Brand<string, TBrand>;

export const asId = <TBrand extends string>(value: string): Id<TBrand> =>
  value as Id<TBrand>;
