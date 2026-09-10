import { randomUUID } from "node:crypto";

export function createWorkerId(): string {
  const host = process.env.HOSTNAME || process.env.COMPUTERNAME || "worker";
  return `${host}:${process.pid}:${randomUUID().slice(0, 8)}`;
}
