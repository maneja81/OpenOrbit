/**
 * Every vendored or bundled third-party asset that ships with OpenOrbit, surfaced in
 * Settings → About. This list is the App Info screen required by CLAUDE.md → Attribution
 * Conventions, and the convention is the reason it exists: anything added under
 * `src/vendor/`, or any bundled font/icon/media not authored in this repo, must gain an
 * entry in the same change that introduces it. thirdPartyNotices.test.ts is the guard.
 *
 * Keeping the upstream LICENSE file next to the asset is required too — the screen is how
 * users see it, the file is what ships with the source.
 */

import tablerLicense from "@/vendor/tabler-icons/LICENSE?raw";

export interface ThirdPartyNotice {
  name: string;
  /** "—" for stock media, which carries no version. */
  version: string;
  copyright: string;
  /** SPDX identifier where one exists; the licence's proper name where it does not. */
  license: string;
  licenseText: string;
  /** Where the asset lives in this repo. */
  path: string;
  sourceUrl: string;
}

/** Pixabay's licence is published on the web and has no SPDX id, so the shipped file
 * points at the canonical text rather than reproducing it. Kept in sync with
 * public/PIXABAY-LICENSE.txt, which ships beside the media itself. */
const PIXABAY_CONTENT_LICENSE = `Pixabay Content License

Applies to the bundled media shipped with OpenOrbit: public/bg.mp4, public/audio/bg.mp3,
public/audio/start-sound.mp3, and public/audio/sfx/**/*.wav.

These files were obtained from Pixabay and are used under the Pixabay Content License,
which has no SPDX identifier. The canonical, authoritative text is published by Pixabay
and is not reproduced here:

  https://pixabay.com/service/license-summary/
  https://pixabay.com/service/terms/

Summary of the terms this project relies on (not a substitute for the licence above):

  - Content may be used free of charge, for commercial and non-commercial purposes,
    without permission from or attribution to the contributor, though attribution is
    appreciated.
  - Content may not be redistributed or sold in unaltered form, including on other
    stock media platforms.
  - Content may not be used in a way that portrays identifiable people in a bad light
    or in a manner they would find offensive.
`;

export const THIRD_PARTY_NOTICES: ThirdPartyNotice[] = [
  {
    name: "Tabler Icons (webfont)",
    version: "3.46.0",
    copyright: "© 2020–2026 Paweł Kuna",
    license: "MIT",
    licenseText: tablerLicense,
    path: "src/vendor/tabler-icons/",
    sourceUrl: "https://tabler.io/icons",
  },
  {
    name: "Background video and sound effects",
    version: "—",
    copyright: "© respective Pixabay contributors",
    license: "Pixabay Content License",
    licenseText: PIXABAY_CONTENT_LICENSE,
    path: "public/bg.mp4, public/audio/",
    sourceUrl: "https://pixabay.com",
  },
];
