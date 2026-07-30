# Fixture source images

Both images are in the **public domain** as works of the United States federal
government (17 U.S.C. § 105). They are committed here so the fixture set can be
regenerated without a network fetch.

| File | Source | Author | License |
|---|---|---|---|
| `eagle.jpg` | [Bald Eagle in flight (9526557308)](https://commons.wikimedia.org/wiki/File:Bald_Eagle_in_flight_(9526557308).jpg) | U.S. Fish and Wildlife Service | Public domain (US federal government work) |
| `portrait.jpg` | [NASA Administrator Bill Nelson Official Portrait (NHQ202105170001)](https://commons.wikimedia.org/wiki/File:NASA_Administrator_Bill_Nelson_Official_Portrait_(NHQ202105170001).jpg) | NASA | Public domain (US federal government work) |

They were chosen for what they exercise, not for their subjects:

- **`eagle.jpg`** is the case the library was built for — a subject against open
  sky. The mask should land the effect on the bird and any cloud detail while
  leaving flat sky untouched, with the falloff breaking into scattered dots
  rather than clipping at an edge.
- **`portrait.jpg`** has a broad range of skin midtones, so sweeping the
  luminance band visibly moves which regions receive the effect. Midtones are
  exactly where thresholding in sRGB instead of linear space goes wrong.

The gradient and high-contrast fixtures are generated procedurally by
`scripts/render-fixtures.mjs` and are not stored here.
