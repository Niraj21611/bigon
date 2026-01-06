import OpenAI from "openai";

let client: OpenAI | null = null;

export const getOpenAIClient = (): OpenAI => {
	const apiKey = process.env.OPENAI_API_KEY;
	if (!apiKey) {
		throw new Error("OPENAI_API_KEY is not configured");
	}

	if (!client) {
		client = new OpenAI({ apiKey });
	}

	return client;
};
