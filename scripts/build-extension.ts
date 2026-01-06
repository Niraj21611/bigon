import { build } from "esbuild";
import { join } from "path";
import { fileURLToPath } from "url";
import { existsSync, copyFileSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, "..", "..");

const root = __dirname;
const extensionDir = join(root, "extension");

const outdir = extensionDir;

async function main() {
	if (!existsSync(extensionDir)) {
		throw new Error(`Extension directory not found at ${extensionDir}`);
	}

	// Ensure manifest is present in output (it lives in extension/ already)
	const manifestSrc = join(extensionDir, "manifest.json");
	const manifestDest = join(outdir, "manifest.json");
	if (!existsSync(manifestSrc)) {
		throw new Error("manifest.json missing in extension/");
	}
	copyFileSync(manifestSrc, manifestDest);

	// Bundle content script
	await build({
		entryPoints: [join(extensionDir, "content.ts")],
		outfile: join(outdir, "content.js"),
		bundle: true,
		format: "iife",
		platform: "browser",
		target: ["chrome114"],
		sourcemap: false,
		minify: true,
		logLevel: "info",
	});

	console.log("Extension build complete.");
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
