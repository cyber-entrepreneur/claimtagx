const SENIOR =
  /\b(director|vp|vice president|chief|owner|head|manager|founder|president|coo|ceo|cio|cto|cfo)\b/i;

export function isSeniorJobTitle(title: string): boolean {
  return SENIOR.test(title);
}

export function buildFacts(input: {
  country: string;
  jobTitle: string;
  useCaseKeys: string[];
  answers: Record<string, string[]>;
  qualification?: { status?: string; score?: number; immediatelyQualified?: boolean };
  source?: string;
  tags?: string[];
}): Record<string, unknown> {
  return {
    country: input.country,
    source: input.source ?? "website",
    useCaseKeys: input.useCaseKeys,
    tags: input.tags ?? [],
    answers: input.answers,
    contact: {
      jobTitle: input.jobTitle,
      seniorRole: isSeniorJobTitle(input.jobTitle),
      country: input.country,
    },
    qualification: {
      status: input.qualification?.status,
      score: input.qualification?.score ?? 0,
      immediatelyQualified: Boolean(input.qualification?.immediatelyQualified),
    },
  };
}
