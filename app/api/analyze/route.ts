import { NextRequest, NextResponse } from "next/server";

import { getOpenAIClient } from "@/lib/openai";
import { validateAnalysis } from "@/lib/validate";

export const runtime = "nodejs";

const PROMPT_TEMPLATE = `You are an expert competitive programmer and computer science instructor.

Analyze the following solution and provide:
1. Time complexity (worst case)
2. Space complexity (worst case)
3. A short, clear explanation

Rules:
- Use Big-O notation
- Assume input size n
- Be conservative (worst case)
- If multiple variables exist, express them clearly
- Do NOT explain language syntax

Return STRICT JSON only:

{
	"time": "O(...)",
	"space": "O(...)",
	"explanation": "..."
}

Code:
{{CODE}}`;

const badRequest = (message: string) => NextResponse.json({ error: message }, { status: 400 });

export async function POST(req: NextRequest) {
	try {
		const body = await req.json();
		const code = typeof body?.code === "string" ? body.code.trim() : "";
		const language = typeof body?.language === "string" && body.language.trim() ? body.language.trim() : "javascript";

		if (!code) {
			return badRequest("Code is required");
		}

			const client = getOpenAIClient();
			const prompt = PROMPT_TEMPLATE.replace("{{CODE}}", code);

			const completion = await client.chat.completions.create({
				model: "gpt-4.1-mini",
				temperature: 0,
				response_format: { type: "json_object" },
				messages: [{ role: "user", content: prompt }],
			});

			// language is currently unused in the prompt (kept for compatibility/future routing)
			void language;

			const rawText = completion.choices[0]?.message?.content ?? "";
			const validated = validateAnalysis(rawText);

		return NextResponse.json(validated);
	} catch (error) {
		console.error("Analyze API error", error);
		return NextResponse.json({ error: "Failed to analyze submission" }, { status: 500 });
	}
}
