export interface HeuristicClassification {
  commercial_intent: "high" | "medium" | "low";
  urgency: "high" | "medium" | "low";
  sentiment: "positive" | "neutral" | "negative";
  competitor_mentioned: boolean;
  potential_enterprise_account: boolean;
  qualification_signal: string;
  confidence: number;
}

export function heuristicClassify(text: string): HeuristicClassification {
  const t = text.toLowerCase();
  const enterprise = /(enterprise|airport|hotel group|chain|100\+|nationwide|global)/.test(t);
  const urgent = /(immediately|asap|this month|urgent|go live)/.test(t);
  const competitor = /(disputes?|lost keys?|paper ticket|incadea|oracle|opera)/.test(t);
  return {
    commercial_intent: enterprise || urgent ? "high" : competitor ? "medium" : "low",
    urgency: urgent ? "high" : "medium",
    sentiment: /(angry|lawsuit|stolen|fraud)/.test(t) ? "negative" : "positive",
    competitor_mentioned: competitor,
    potential_enterprise_account: enterprise,
    qualification_signal: enterprise ? "enterprise_language" : "standard",
    confidence: 55,
  };
}
