/// <reference types="node" />
import { createHmac, timingSafeEqual } from "node:crypto";
import type { AccountId, DeviceId, SessionId } from "../domain/ids.js";
import type { AuthContext } from "../domain/session.js";
import type { Clock, EpochMillis } from "../shared/clock.js";
import { asId } from "../shared/ids.js";
import type { TokenService } from "../ports/outbound.js";

const toBase64Url = (value: string | Buffer): string =>
  Buffer.from(value).toString("base64url");

const fromBase64Url = (value: string): Buffer => Buffer.from(value, "base64url");

interface JwtHeader {
  readonly alg: "HS256";
  readonly typ: "JWT";
}

interface AccessPayload {
  readonly sub: string;
  readonly sid: string;
  readonly did?: string;
  readonly scopes: readonly string[];
  readonly exp: number;
}

interface RefreshPayload {
  readonly sid: string;
  readonly exp: number;
  readonly typ: "refresh";
}

const sign = (header: JwtHeader, payload: object, secret: string): string => {
  const encodedHeader = toBase64Url(JSON.stringify(header));
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac("sha256", secret).update(signingInput).digest("base64url");
  return `${signingInput}.${signature}`;
};

const parseJwt = (
  token: string,
): { header: JwtHeader; payload: Record<string, unknown>; signature: Buffer } | null => {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  if (encodedHeader === undefined || encodedPayload === undefined || encodedSignature === undefined) {
    return null;
  }
  try {
    const header = JSON.parse(fromBase64Url(encodedHeader).toString("utf8")) as JwtHeader;
    const payload = JSON.parse(fromBase64Url(encodedPayload).toString("utf8")) as Record<
      string,
      unknown
    >;
    const signature = fromBase64Url(encodedSignature);
    return { header, payload, signature };
  } catch {
    return null;
  }
};

const verifySignature = (token: string, secret: string, signature: Buffer): boolean => {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return false;
  }
  const signingInput = `${parts[0]}.${parts[1]}`;
  const expected = createHmac("sha256", secret).update(signingInput).digest();
  if (expected.length !== signature.length) {
    return false;
  }
  return timingSafeEqual(expected, signature);
};

const epochSeconds = (ms: EpochMillis): number => Math.floor(ms / 1000);

/** HS256 JWT token service for development and tests. */
export class DevJwtTokenService implements TokenService {
  constructor(
    private readonly secret: string,
    private readonly clock: Clock,
  ) {}

  async issueAccess(context: AuthContext, expiresAt: EpochMillis): Promise<string> {
    const payload: AccessPayload = {
      sub: context.accountId,
      sid: context.sessionId,
      scopes: context.scopes,
      exp: epochSeconds(expiresAt),
      ...(context.deviceId !== undefined ? { did: context.deviceId } : {}),
    };
    return sign({ alg: "HS256", typ: "JWT" }, payload, this.secret);
  }

  async issueRefresh(sessionId: SessionId, expiresAt: EpochMillis): Promise<string> {
    const payload: RefreshPayload = {
      sid: sessionId,
      exp: epochSeconds(expiresAt),
      typ: "refresh",
    };
    return sign({ alg: "HS256", typ: "JWT" }, payload, this.secret);
  }

  async verifyAccess(token: string): Promise<AuthContext | null> {
    const parsed = parseJwt(token);
    if (parsed === null || parsed.header.alg !== "HS256" || parsed.header.typ !== "JWT") {
      return null;
    }
    if (!verifySignature(token, this.secret, parsed.signature)) {
      return null;
    }

    const payload = parsed.payload as Partial<AccessPayload>;
    if (
      typeof payload.sub !== "string" ||
      typeof payload.sid !== "string" ||
      typeof payload.exp !== "number" ||
      !Array.isArray(payload.scopes)
    ) {
      return null;
    }
    if (payload.exp <= epochSeconds(this.clock.now())) {
      return null;
    }

    const base: AuthContext = {
      accountId: asId(payload.sub) as AccountId,
      sessionId: asId(payload.sid) as SessionId,
      scopes: payload.scopes,
    };
    if (typeof payload.did === "string") {
      return { ...base, deviceId: asId(payload.did) as DeviceId };
    }
    return base;
  }

  async verifyRefresh(token: string): Promise<SessionId | null> {
    const parsed = parseJwt(token);
    if (parsed === null || parsed.header.alg !== "HS256" || parsed.header.typ !== "JWT") {
      return null;
    }
    if (!verifySignature(token, this.secret, parsed.signature)) {
      return null;
    }

    const payload = parsed.payload as Partial<RefreshPayload>;
    if (
      payload.typ !== "refresh" ||
      typeof payload.sid !== "string" ||
      typeof payload.exp !== "number"
    ) {
      return null;
    }
    if (payload.exp <= epochSeconds(this.clock.now())) {
      return null;
    }
    return asId(payload.sid) as SessionId;
  }
}
