import { defineConfig } from "tsdown"

export default defineConfig({
	entry: ["src/hooks/*.ts"],
	outDir: "pb_hooks",
	format: "cjs", // PocketBase's JSVM (goja) has no ESM support
	platform: "neutral", // don't assume Node; fail fast on node builtins
	target: "es2020", // JSVM supports ES2020 features (no async/event loop)
	outExtensions: () => ({ js: ".js" }), // so PocketBase auto-loads the files
	dts: false,
	clean: true, // pb_hooks is generated-only
	sourcemap: false,
	shims: false
})
