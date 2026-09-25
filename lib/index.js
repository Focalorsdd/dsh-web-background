/**
 * dsh-web-background — DeepSeek Harness Web GUI background plugin.
 *
 * Node half (DSH ≥ 0.1.7): declares the plugin's volatile `Config`
 * (image / overlay / enabled / themeEnabled / themePalette / themeFont /
 * themeCustom / dialog size). The Host settings service projects every
 * volatile field into the settings mirror that the browser half reads through
 * `ctx.configForms.get("dsh-web-background")`, and persists user writes into
 * the profile patch layer (cordis.patch.yml). `apply` only opts the entry out
 * of the auto-generated settings page — the plugin ships its own Appearance
 * editor row.
 *
 * The browser half (lib/client.js) is shipped through exports["./client"]
 * and discovered via the package.json `dsh.client` declaration.
 */
import z from "@deepseek-ai/schemastery";

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
 * Live preferences. Every field is volatile: edits apply without a remount
 * and are editable through the Host settings document. `image` is a
 * CSS-ready value: an external URL, a `url(...)` wrapper, or a data: URI;
 * empty means the shipped default. `themeCustom` stores per-surface manual
 * color + alpha overrides; an empty color means "follow the picture-derived
 * automatic theme". Dialog sizes of 0 mean the modal's natural size.
 */
const Config = z.object({
	image: z.string().default("").volatile(),
	overlay: z.number().default(DEFAULT_OVERLAY).volatile(),
	enabled: z.boolean().default(true).volatile(),
	themeEnabled: z.boolean().default(true).volatile(),
	themePalette: z.array(z.string()).default([]).volatile(),
	themeFont: z.string().default("").volatile(),
	themeCustom: themeCustomSchema().volatile(),
	// Appearance dialog size in px; 0 means the modal's natural size.
	dialogWidth: z.number().default(0).volatile(),
	dialogHeight: z.number().default(0).volatile(),
});

function apply(ctx) {
	// Opt out of the auto-generated settings page: the Appearance row in the
	// browser half is the only editor. Same incantation as ui-theme's Host
	// half; the presentation policy is keyed by fiber, so a hot-reload
	// replaces it cleanly.
	ctx.inject(["settings"], (child) => {
		child.effect(() => child.settings.configure({ auto: false }, ctx.fiber));
	});
}

export { apply, Config };
