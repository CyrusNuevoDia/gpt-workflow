import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  verifyNPMArtifact,
  verifyPyPIArtifacts
} from "../scripts/verify-registry-artifacts.js"

async function withDirectory(
  run: (directory: string) => Promise<void>
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "gpt-workflow-registry-"))
  try {
    await run(directory)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
}

test("npm verification requires byte-identical integrity", async () => {
  await withDirectory(async (directory) => {
    const tarball = join(directory, "gpt-workflow-1.2.3.tgz")
    const bytes = new TextEncoder().encode("npm artifact")
    await writeFile(tarball, bytes)
    const integrity = `sha512-${new Bun.CryptoHasher("sha512").update(bytes).digest("base64")}`

    await expect(
      verifyNPMArtifact(tarball, JSON.stringify({ dist: { integrity } }))
    ).resolves.toBeUndefined()
    await expect(
      verifyNPMArtifact(
        tarball,
        JSON.stringify({ dist: { integrity: "sha512-wrong" } })
      )
    ).rejects.toThrow("npm artifact mismatch")
  })
})

test("PyPI verification requires the exact wheel and sdist hashes", async () => {
  await withDirectory(async (directory) => {
    await mkdir(join(directory, "ignored"))
    const files = [
      ["gpt_workflow-1.2.3-py3-none-any.whl", "wheel"],
      ["gpt_workflow-1.2.3.tar.gz", "sdist"]
    ] as const
    await Promise.all(
      files.map(([name, contents]) =>
        writeFile(join(directory, name), contents)
      )
    )
    const urls = files.map(([filename, contents]) => ({
      digests: {
        sha256: new Bun.CryptoHasher("sha256").update(contents).digest("hex")
      },
      filename
    }))

    await expect(
      verifyPyPIArtifacts(directory, JSON.stringify({ urls }))
    ).resolves.toBeUndefined()
    const [wheel] = urls
    if (!wheel) {
      throw new Error("missing wheel fixture")
    }
    wheel.digests.sha256 = "wrong"
    await expect(
      verifyPyPIArtifacts(directory, JSON.stringify({ urls }))
    ).rejects.toThrow("PyPI artifacts differ")
  })
})
