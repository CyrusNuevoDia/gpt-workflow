import { readdir, readFile } from "node:fs/promises"
import { basename, join, resolve } from "node:path"

type PyPIFile = {
  digests?: { sha256?: unknown }
  filename?: unknown
}

function digest(algorithm: "sha256" | "sha512", value: Uint8Array): string {
  return new Bun.CryptoHasher(algorithm).update(value).digest("base64")
}

export async function verifyNPMArtifact(
  tarball: string,
  registryJSON: string
): Promise<void> {
  const remote = JSON.parse(registryJSON) as {
    dist?: { integrity?: unknown }
  }
  const integrity = remote.dist?.integrity
  if (typeof integrity !== "string") {
    throw new Error("npm registry response omitted dist.integrity")
  }
  const local = `sha512-${digest("sha512", await readFile(tarball))}`
  if (local !== integrity) {
    throw new Error(
      `npm artifact mismatch for ${basename(tarball)}: local=${local} remote=${integrity}`
    )
  }
}

export async function verifyPyPIArtifacts(
  directory: string,
  registryJSON: string
): Promise<void> {
  const response = JSON.parse(registryJSON) as { urls?: unknown }
  if (!Array.isArray(response.urls)) {
    throw new Error("PyPI registry response omitted urls")
  }
  const names = (await readdir(directory))
    .filter((name) => name.endsWith(".whl") || name.endsWith(".tar.gz"))
    .sort()
  if (names.length !== 2) {
    throw new Error(
      `expected one wheel and one sdist, found ${names.join(",")}`
    )
  }
  const local = new Map(
    await Promise.all(
      names.map(
        async (name) =>
          [
            name,
            new Bun.CryptoHasher("sha256")
              .update(await readFile(join(directory, name)))
              .digest("hex")
          ] as const
      )
    )
  )
  const remote = new Map<string, string>()
  for (const value of response.urls as PyPIFile[]) {
    const { digests, filename } = value
    const sha256 = digests?.sha256
    if (typeof filename !== "string" || typeof sha256 !== "string") {
      throw new Error("PyPI registry response contained invalid file metadata")
    }
    remote.set(filename, sha256)
  }
  if (
    local.size !== remote.size ||
    [...local].some(([name, hash]) => remote.get(name) !== hash)
  ) {
    throw new Error(
      `PyPI artifacts differ: local=${JSON.stringify(Object.fromEntries(local))} remote=${JSON.stringify(Object.fromEntries(remote))}`
    )
  }
}

async function main(): Promise<void> {
  const [, , registry, artifact, responsePath] = process.argv
  if (!(registry && artifact && responsePath)) {
    throw new Error(
      "Usage: bun scripts/verify-registry-artifacts.ts <npm|pypi> <artifact> <registry.json>"
    )
  }
  const response = await readFile(resolve(responsePath), "utf8")
  if (registry === "npm") {
    await verifyNPMArtifact(resolve(artifact), response)
  } else if (registry === "pypi") {
    await verifyPyPIArtifacts(resolve(artifact), response)
  } else {
    throw new Error(`Unknown registry: ${registry}`)
  }
  console.log(`${registry} artifact verification: PASS`)
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
