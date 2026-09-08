export const connectorMetrics = {
  webhookAccepted: 0,
  webhookRejected: 0,
  webhookDeduplicated: 0,
  inboundProcessed: 0,
  inboundQuarantined: 0,
  inboundFailed: 0,
  outboundQueued: 0,
  outboundAccepted: 0,
  outboundDelivered: 0,
  outboundRead: 0,
  outboundFailed: 0,
  outboundUncertain: 0,
  authFailures: 0,
  deadLetters: 0,
};

export function snapshotConnectorMetrics() {
  return { ...connectorMetrics };
}

export function resetConnectorMetricsForTests() {
  for (const key of Object.keys(connectorMetrics) as Array<keyof typeof connectorMetrics>) {
    connectorMetrics[key] = 0;
  }
}
