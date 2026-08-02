/**
 * OpenOrbit's own licence, shown in Settings → About alongside third-party notices.
 *
 * The text is inlined rather than imported from the root LICENSE file: that file sits
 * outside Vite's `src` root, so `?raw` on it would need `server.fs.allow` widened for one
 * string. The root LICENSE remains the copy that ships with the source, and
 * appLicense.test.ts guards the two against drifting apart.
 */

export const APP_LICENSE = {
  spdx: "MIT",
  copyright: "© 2026 Mohit Aneja",
  text: `MIT License

Copyright (c) 2026 Mohit Aneja

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`,
} as const;
