/**
 * Host half of the font-scale bundle.
 *
 * This bundle owns no Host capability: the conversation font size lives in the
 * Client's theme service (`setFontSize`), which is already Host-backed through
 * the `ui-theme` settings scope. The module exists only because a bundle patch
 * row needs a resolvable entry point.
 */
export function apply() {}
