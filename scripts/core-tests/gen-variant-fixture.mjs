// Generates fixtures/base-project.desel.json and fixtures/variant-16x9.desel.json
// using the UI canonical writer, so the Rust harness can prove byte-level
// compatibility with the native importer/exporter. Run: node scripts/core-tests/gen-variant-fixture.mjs
import fs from 'node:fs';
import path from 'node:path';
import { canonicalProjectFile, buildVariantProjects } from '../../src/lib/variant-package.ts';

// A 1x1 opaque PNG (rust image crate accepts it).
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const deck = {
  id: 'deck_fixture', title: 'Fixture deck', caption: 'Fixture caption', aspect: '4:5',
  slides: [
    { id: 'slide_a', title: 'Cover', html: '<html><head><style>h1{color:#123456}</style></head><body style="margin:0;width:1080px;height:1350px;background:#e6d8b8"><h1 style="position:absolute;left:100px;top:200px;font-size:90px">Fixture cover</h1><img src="asset:asset_pic"></body></html>', rationale: 'why', hidden: false },
    { id: 'slide_b', title: 'Body', html: '<body style="margin:0;width:1080px;height:1350px;background:#274b68"><p>Second</p></body>', rationale: '', hidden: false },
  ],
  styleGuide: 'editorial', palette: ['#123456'], brandHandle: '@fixture', saveLabel: 'Save this post',
  fromTemplateId: null, createdAt: '2026-01-02T03:04:05Z', updatedAt: '2026-01-02T03:04:05Z',
};
const assets = [{
  provenance: { sourceUrl: 'https://example.com/pic', creator: 'Fixture', rightsNote: 'unverified', altText: 'dot', medium: '' },
  referenceRole: 'cover', referenceStatus: 'approved', id: 'asset_pic', deckId: 'deck_fixture',
  name: 'pic.png', mime: 'image/png', data: png,
  profile: { width: 1, height: 1, palette: ['#ffffff'], luminance: 1, contrast: 0, lightRatio: 1 },
  createdAt: '2026-01-02T03:04:05Z',
}];
const comments = [{ id: 'comment_a', deckId: 'deck_fixture', slideId: 'slide_a', x: 120, y: 0.5, body: 'Check this', author: 'user', status: 'open', selector: 'h1', createdAt: '2026-01-02T03:04:05Z' }];
const workspace = {
  draft: 'draft text', queue: [{ id: 'q1', text: 'brief', scope: { mode: 'produce', slideId: null, assetIds: [], lockedSlideIds: [], lockedObjects: [] } }],
  memory: [{ id: 'm1', text: 'remember', source: 'user', pinned: true, kind: 'decision' }],
  mode: 'produce', lockedSlideIds: ['slide_b'], lockedObjects: [{ slideId: 'slide_a', selector: 'h1', label: 'Title' }],
};

const dir = path.join(import.meta.dirname, 'fixtures');
const base = await canonicalProjectFile(deck, assets, comments, workspace);
fs.writeFileSync(path.join(dir, 'base-project.desel.json'), base);
const variants = await buildVariantProjects(deck, assets, comments, workspace);
const v = variants.find((v) => v.aspect === '16:9');
fs.writeFileSync(path.join(dir, 'variant-16x9.desel.json'), v.text);
console.log('fixtures written:', fs.readdirSync(dir).join(', '), '| variant file:', v.fileName);
