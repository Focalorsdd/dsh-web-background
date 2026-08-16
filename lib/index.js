/**
 * dsh-web-background — DeepSeek Harness Web GUI background plugin.
 *
 * Node half: registers the `dsh-web-background` settings namespace
 * (image / overlay / enabled / themeEnabled / themePalette / themeFont)
 * with the Host settings provider, so the browser half's settings row
 * persists into the user-settings document.
 * The browser half (lib/client.js) is shipped through exports["./client"]
 * and discovered via the package.json `dsh.client` declaration.
 */
import z from "@deepseek-ai/schemastery";

/** Settings namespace owned by this plugin (lowercase kebab-case). */
const SETTINGS_NAMESPACE = "dsh-web-background";

/** Default scrim opacity over the image (keeps text readable). */
const DEFAULT_OVERLAY = 0.55;

/** Surface rows exposed by the custom-theme editor, with default alpha. */
const THEME_SURFACE_DEFAULTS = {
	base: 1,
	dialog: 0.72,
	panel: 0.66,
	code: 0.6,
	bubble: 0.66,
	input: 0.66,
	menu: 0.72,
	selector: 0.66,
	sidebar: 0.52,
	sidebarActive: 0.6,
	highlight: 1,
};

function surfaceSchema(defaultAlpha) {
	return z
		.object({
			color: z.string().default(""),
			alpha: z.number().default(defaultAlpha),
		})
		.default({ color: "", alpha: defaultAlpha });
}

function themeCustomSchema() {
	return z.object({
		base: surfaceSchema(THEME_SURFACE_DEFAULTS.base),
		dialog: surfaceSchema(THEME_SURFACE_DEFAULTS.dialog),
		panel: surfaceSchema(THEME_SURFACE_DEFAULTS.panel),
		code: surfaceSchema(THEME_SURFACE_DEFAULTS.code),
		bubble: surfaceSchema(THEME_SURFACE_DEFAULTS.bubble),
		input: surfaceSchema(THEME_SURFACE_DEFAULTS.input),
		menu: surfaceSchema(THEME_SURFACE_DEFAULTS.menu),
		selector: surfaceSchema(THEME_SURFACE_DEFAULTS.selector),
		sidebar: surfaceSchema(THEME_SURFACE_DEFAULTS.sidebar),
		sidebarActive: surfaceSchema(THEME_SURFACE_DEFAULTS.sidebarActive),
		highlight: surfaceSchema(THEME_SURFACE_DEFAULTS.highlight),
	}).default({
		base: { color: "", alpha: THEME_SURFACE_DEFAULTS.base },
		dialog: { color: "", alpha: THEME_SURFACE_DEFAULTS.dialog },
		panel: { color: "", alpha: THEME_SURFACE_DEFAULTS.panel },
		code: { color: "", alpha: THEME_SURFACE_DEFAULTS.code },
		bubble: { color: "", alpha: THEME_SURFACE_DEFAULTS.bubble },
		input: { color: "", alpha: THEME_SURFACE_DEFAULTS.input },
		menu: { color: "", alpha: THEME_SURFACE_DEFAULTS.menu },
		selector: { color: "", alpha: THEME_SURFACE_DEFAULTS.selector },
		sidebar: { color: "", alpha: THEME_SURFACE_DEFAULTS.sidebar },
		sidebarActive: { color: "", alpha: THEME_SURFACE_DEFAULTS.sidebarActive },
		highlight: { color: "", alpha: THEME_SURFACE_DEFAULTS.highlight },
	});
}

/**
 * Durable settings schema. `image` is a CSS-ready value: an external URL,
 * a `url(...)` wrapper, or a data: URI; empty means the shipped default.
 * `themeCustom` stores per-surface manual color + alpha overrides; an empty
 * color means "follow the picture-derived automatic theme".
 */
const BackgroundSettingsSchema = z.object({
	image: z.string().default(""),
	overlay: z.number().default(DEFAULT_OVERLAY),
	enabled: z.boolean().default(true),
	themeEnabled: z.boolean().default(true),
	themePalette: z.array(z.string()).default([]),
	themeFont: z.string().default(""),
	themeCustom: themeCustomSchema(),
});

function apply(ctx) {
	ctx.inject(["settings"], (settingsCtx) => {
		settingsCtx.settings.register(SETTINGS_NAMESPACE, BackgroundSettingsSchema);
	});
}

export { apply };
