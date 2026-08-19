/**
 * Does a shipped CHANGELOG describe its own published version as unreleased?
 *
 * Extracted from drift-guard specifically so it can be TESTED. drift-guard
 * itself is network-dependent and untested, and a check that silently never
 * fires reads as a clean bill of health — which is the failure this check was
 * written to catch in the first place (VERIFIED.md, absence pattern #9).
 *
 * @param {string} version   the version npm serves for this package
 * @param {string} text      contents of the CHANGELOG.md **shipped in the tarball**
 * @returns {string|null}    the offending heading, or null
 */
export function selfDescribesUnreleased(version, text) {
    if (!version || !text) return null;
    const re = new RegExp(`^##+\\s*v?${version.replace(/\./g, '\\.')}(?![\\d.])(.*)$`, 'mi');
    const m = re.exec(text);
    if (!m) return null;                                  // no section: a different defect
    return /\bunreleased\b|\bunpublished\b|\bTBD\b|\bpending\b/i.test(m[1]) ? m[0].trim() : null;
}
