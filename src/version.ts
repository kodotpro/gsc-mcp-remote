/**
 * The release version, in a module with no imports of its own.
 *
 * It used to live only in server-factory.ts, but the public pages show it too,
 * and importing it from there would pull every tool implementation (and
 * googleapis) into anything that renders a page — including the test suite,
 * which renders pages straight from dist/. Bump it together with package.json
 * and manifest.json.
 */
export const SERVER_VERSION = "3.8.0";
