// PocketBase's JSVM (goja) provides a CommonJS require(); pb_data/types.d.ts
// doesn't declare it. Resolve paths against __hooks, e.g.
// require(`${__hooks}/mail.js`).
declare function require(path: string): any
