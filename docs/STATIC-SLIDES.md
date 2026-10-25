# Static slide safety

Slide previews, thumbnails, board layers and render-review candidates use the
same static-document preparation. It parses HTML, removes executable/container
content, event handlers, navigation destinations and refresh/base/link tags.
A document CSP rejects scripts, network connections, external stylesheets,
frames, media and form submission. Inline CSS and SVG remain available for art.
HTTPS/data/blob images are allowed, so a remote image can still make a request;
this is not offline-only rendering or proof an image's source is trustworthy.

Consumers retain a script-disabled iframe sandbox. Same-origin is needed for
geometry measurement and manual editing; never add allow-scripts. CSP is
additional protection, not a replacement for sandboxing or native tool gates.

Portable imports reject obvious active HTML before persistence. The checksum is
for damage detection only. Browser rendering still sanitizes imported artwork.
Image assets require supported MIME/byte agreement, bounds and full decoding.
Native-image decoder allocations are capped. File/item/expanded-HTML limits
prevent a tiny token-heavy file from allocating unlimited inlined image text.

Local browser fixtures verify that scripts/base/refresh/frames and encoded
script attributes are removed, stylesheet imports fail with CSP, and inline
CSS/SVG still render. Pixel inspection of the sample deck confirms appearance.
This is defense in depth for static artwork, not a complete HTML-security audit.
