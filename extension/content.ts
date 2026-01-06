// Content script injected on LeetCode problem pages
// Responsibilities: detect accepted submissions, inject analysis button, read Monaco code, hash, cache, and call backend API.

type AnalysisResult = {
	time: string;
	space: string;
	explanation: string;
};

type MonacoGlobals = {
	monaco?: {
		editor?: {
			getModels?: () => Array<{
				getValue?: () => string;
				getLanguageId?: () => string;
			}>;
		};
	};
};

declare const chrome: {
	storage: {
		local: {
			get: (keys: string | string[] | object, callback: (items: Record<string, unknown>) => void) => void;
			set: (items: Record<string, unknown>, callback?: () => void) => void;
		};
	};
};

const CARD_ID = "leetcode-ai-analyzer-card";
const BUTTON_ID = "leetcode-ai-analyzer-button";
const STORAGE_PREFIX = "leetcode-ai-analyzer";
const ACCEPTED_TEXT = "Accepted";

// Prefer build-time injected endpoint; fallback to local dev
const API_ENDPOINT =
	(typeof process !== "undefined" && (process as { env?: Record<string, string> }).env?.NEXT_PUBLIC_ANALYZE_ENDPOINT) ||
	"http://localhost:3000/api/analyze";

const isLeetCodeProblemPage = () => /^https:\/\/leetcode\.com\/problems\//.test(window.location.href);

const waitForElement = (predicate: () => HTMLElement | null, attempts = 20, delayMs = 250): Promise<HTMLElement | null> => {
	return new Promise((resolve) => {
		let tries = 0;
		const tick = () => {
			const el = predicate();
			if (el || tries >= attempts) {
				resolve(el ?? null);
				return;
			}
			tries += 1;
			window.setTimeout(tick, delayMs);
		};
		tick();
	});
};

const sha256 = async (input: string): Promise<string> => {
	const encoder = new TextEncoder();
	const data = encoder.encode(input);
	const digest = await crypto.subtle.digest("SHA-256", data);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
};

const getFromStorage = <T>(key: string): Promise<T | null> =>
	new Promise((resolve) => {
		try {
			chrome.storage.local.get(key, (items) => {
				const value = items[key];
				resolve((value as T) ?? null);
			});
		} catch (error) {
			console.error("Storage get error", error);
			resolve(null);
		}
	});

const setInStorage = (key: string, value: unknown): Promise<void> =>
	new Promise((resolve) => {
		try {
			chrome.storage.local.set({ [key]: value }, () => resolve());
		} catch (error) {
			console.error("Storage set error", error);
			resolve();
		}
	});

const getMonacoCode = (): { code: string; language: string } => {
		const monaco = (window as unknown as MonacoGlobals).monaco;
	const model = monaco?.editor?.getModels?.()?.[0];
	const code = model?.getValue?.() ?? "";
	const langFromModel = model?.getLanguageId?.();
	const language = langFromModel || detectLanguageFromUI() || "javascript";
	return { code, language };
};

const detectLanguageFromUI = (): string | null => {
	const selectors = [
		"[data-cy=lang-select] .ant-select-selection-item",
		"[data-cy=lang-select] .select-style",
		".language-select .ant-select-selection-item",
		"[class*='language'] [class*='select']",
	];
	for (const selector of selectors) {
		const el = document.querySelector(selector);
		const text = el?.textContent?.trim();
		if (text) return text.toLowerCase();
	}

	// Inspect monaco aria-label
	const monacoEl = document.querySelector(".monaco-editor");
	const aria = monacoEl?.getAttribute("aria-label")?.toLowerCase();
	if (aria && aria.includes("editor")) {
		const match = aria.match(/editor\s+content\s+.*?\s+(\w+)/);
		if (match?.[1]) return match[1].toLowerCase();
	}

	return null;
};

const buildCacheKey = (language: string, hash: string) => `${STORAGE_PREFIX}:${language}:${hash}`;

const removeExistingCard = () => {
	const existing = document.getElementById(CARD_ID);
	if (existing) existing.remove();
};

const createCard = (content: string, isError = false) => {
	removeExistingCard();
	const card = document.createElement("div");
	card.id = CARD_ID;
	card.style.position = "fixed";
	card.style.bottom = "16px";
	card.style.right = "16px";
	card.style.width = "320px";
	card.style.maxWidth = "90vw";
	card.style.background = "#0f172a";
	card.style.color = "#e2e8f0";
	card.style.border = "1px solid #1f2937";
	card.style.borderRadius = "8px";
	card.style.boxShadow = "0 12px 30px rgba(0,0,0,0.35)";
	card.style.padding = "14px 16px";
	card.style.fontFamily = "Inter, system-ui, -apple-system, sans-serif";
	card.style.zIndex = "2147483646";
	card.style.backdropFilter = "blur(8px)";
	card.style.cursor = "default";

	const header = document.createElement("div");
	header.style.display = "flex";
	header.style.alignItems = "center";
	header.style.justifyContent = "space-between";
	header.style.marginBottom = "10px";

	const title = document.createElement("div");
	title.textContent = isError ? "Analysis Error" : "Time & Space";
	title.style.fontWeight = "600";
	title.style.fontSize = "14px";

	const close = document.createElement("button");
	close.textContent = "✕";
	close.style.background = "transparent";
	close.style.border = "none";
	close.style.color = "#94a3b8";
	close.style.cursor = "pointer";
	close.style.fontSize = "14px";
	close.addEventListener("click", () => card.remove());

	header.appendChild(title);
	header.appendChild(close);
	card.appendChild(header);

	const body = document.createElement("div");
	body.style.fontSize = "13px";
	body.style.lineHeight = "1.45";
	body.textContent = content;
	if (isError) {
		body.style.color = "#fca5a5";
	}
	card.appendChild(body);

	document.body.appendChild(card);
};

const renderResult = (result: AnalysisResult) => {
	const lines = [`Time: ${result.time}`, `Space: ${result.space}`, result.explanation];
	createCard(lines.join("\n"));
};

const renderError = (message: string) => {
	createCard(message, true);
};

const setButtonState = (button: HTMLButtonElement, state: "idle" | "loading") => {
	if (state === "loading") {
		button.disabled = true;
		button.textContent = "Analyzing...";
	} else {
		button.disabled = false;
		button.textContent = "Analyze Time & Space";
	}
};

const ensureButton = (anchor: HTMLElement) => {
	if (document.getElementById(BUTTON_ID)) return;
	const button = document.createElement("button");
	button.id = BUTTON_ID;
	button.textContent = "Analyze Time & Space";
	button.style.marginLeft = "8px";
	button.style.padding = "8px 12px";
	button.style.borderRadius = "6px";
	button.style.border = "1px solid #1f2937";
	button.style.background = "#111827";
	button.style.color = "#e2e8f0";
	button.style.cursor = "pointer";
	button.style.fontSize = "12px";
	button.style.fontWeight = "600";
	button.style.boxShadow = "0 6px 16px rgba(0,0,0,0.2)";
	button.style.transition = "transform 120ms ease, box-shadow 120ms ease";

	button.addEventListener("mouseenter", () => {
		button.style.transform = "translateY(-1px)";
		button.style.boxShadow = "0 10px 20px rgba(0,0,0,0.25)";
	});
	button.addEventListener("mouseleave", () => {
		button.style.transform = "translateY(0)";
		button.style.boxShadow = "0 6px 16px rgba(0,0,0,0.2)";
	});

	button.addEventListener("click", async () => {
		setButtonState(button, "loading");
		try {
			const { code, language } = getMonacoCode();
			if (!code.trim()) {
				renderError("Could not read your code from the editor.");
				return;
			}

			const hash = await sha256(code);
			const cacheKey = buildCacheKey(language, hash);
			const cached = await getFromStorage<AnalysisResult>(cacheKey);
			if (cached) {
				renderResult(cached);
				return;
			}

			createCard("Analyzing with OpenAI...");
			const response = await fetch(API_ENDPOINT, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ code, language }),
			});

			if (!response.ok) {
				const msg = await response.text();
				throw new Error(msg || "Request failed");
			}

			const result = (await response.json()) as AnalysisResult;
			await setInStorage(cacheKey, result);
			renderResult(result);
		} catch (error) {
			console.error("Analysis error", error);
			renderError("Unable to analyze submission. Please try again.");
		} finally {
			setButtonState(button, "idle");
		}
	});

	// Place the button next to the accepted result node when possible
	if (anchor.parentElement) {
		anchor.parentElement.appendChild(button);
	} else {
		anchor.appendChild(button);
	}
};

const findAcceptedNode = (root: ParentNode): HTMLElement | null => {
	const candidates = Array.from(root.querySelectorAll("span, div, p, strong"));
		const strongMatch = candidates.find((el) => el.textContent?.trim().startsWith(ACCEPTED_TEXT));
		if (strongMatch) return strongMatch as HTMLElement;
		const weakMatch = candidates.find((el) => el.textContent?.includes(ACCEPTED_TEXT));
		return (weakMatch as HTMLElement) ?? null;
};

const observeAccepted = () => {
	const target = document.body;
	if (!target) return;

	// Initial scan
	const initial = findAcceptedNode(target);
	if (initial) ensureButton(initial);

	const observer = new MutationObserver((mutations) => {
		for (const mutation of mutations) {
			for (const node of Array.from(mutation.addedNodes)) {
				if (!(node instanceof HTMLElement)) continue;
				const acceptedNode = node && findAcceptedNode(node);
				if (acceptedNode) {
					ensureButton(acceptedNode);
					return;
				}
			}
		}
	});

	observer.observe(target, { childList: true, subtree: true });
};

const init = async () => {
	if (!isLeetCodeProblemPage()) return;

	// Wait for main app root to exist to avoid running too early
	await waitForElement(() => document.getElementById("__next"));
	observeAccepted();
};

init().catch((error) => console.error("Initialization error", error));
