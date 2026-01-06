export type AnalysisResult = {
	time: string;
	space: string;
	explanation: string;
};

const isBigO = (value: unknown): value is string => {
	if (typeof value !== "string") return false;
	const trimmed = value.trim();
	return /^O\(.+\)$/.test(trimmed);
};

const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

export const validateAnalysis = (raw: string): AnalysisResult => {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error("Malformed JSON from OpenAI");
	}

	if (typeof parsed !== "object" || parsed === null) {
		throw new Error("Invalid response shape");
	}

	const { time, space, explanation } = parsed as Record<string, unknown>;

	if (!isBigO(time) || !isBigO(space) || !isNonEmptyString(explanation)) {
		throw new Error("Response failed validation");
	}

	return {
		time: (time as string).trim(),
		space: (space as string).trim(),
		explanation: (explanation as string).trim(),
	};
};
