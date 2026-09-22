# Original release archive

This directory preserves the publicly distributed Grok Bot 0.18.0 macOS arm64
installer that the reconstruction was built from. The large binary is tracked
with Git LFS.

## Artifact

| Platform | Architecture | Bytes | SHA-256 | Original URL |
| --- | --- | ---: | --- | --- |
| macOS | arm64 | 155,793,020 | `a253ccd8aab01e083f9812a0264354c5034d8ba7f0610bbb557e82ae77d203eb` | `https://downloads.cursor.com/grokbot/stable/darwin-arm64/0.18.0/Grok_Bot_0.18.0.dmg` |

The original public URL now answers HTTP 403, so the LFS copy is what makes a
fresh clone buildable. Bootstrap prefers it and verifies the digest before use.

The Windows x64 installer of the same release is out of scope for this
repository and is neither listed nor hosted.

## Fetching and verification

```sh
git lfs install
git lfs pull
(cd research-archives/original/0.18.0 && shasum -a 256 -c SHA256SUMS)
```

`artifacts.json` is the machine-readable source, size and digest inventory.
These files are preservation inputs, not reconstructed build outputs.
