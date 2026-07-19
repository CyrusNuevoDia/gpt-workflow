import { expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  checkPythonVersion,
  syncPythonVersion
} from "../scripts/sync-python-version.js"

async function withRepository(
  run: (repository: string) => Promise<void>
): Promise<void> {
  const repository = await mkdtemp(join(tmpdir(), "gpt-workflow-version-"))
  const sdk = join(repository, "sdks/python")
  await mkdir(join(sdk, "src/gpt_workflow"), { recursive: true })
  await mkdir(join(sdk, "scripts"), { recursive: true })
  await writeFile(
    join(repository, "package.json"),
    JSON.stringify({ name: "gpt-workflow", version: "1.2.3" })
  )
  await writeFile(join(sdk, "pyproject.toml"), 'version = "0.0.1"\n')
  await writeFile(
    join(sdk, "src/gpt_workflow/_version.py"),
    'VERSION = "0.0.1"\n'
  )
  await writeFile(
    join(sdk, "scripts/verify-package.py"),
    'EXPECTED_VERSION = "0.0.1"\n'
  )
  await writeFile(
    join(sdk, "README.md"),
    "synchronized at `0.0.1`\n" +
      "bunx --bun gpt-workflow@0.0.1\n" +
      "gpt-workflow==0.0.1\n"
  )
  await writeFile(
    join(sdk, "uv.lock"),
    '[[package]]\nname = "gpt-workflow"\nversion = "0.0.1"\n'
  )
  try {
    await run(repository)
  } finally {
    await rm(repository, { force: true, recursive: true })
  }
}

const updateLock = async (sdk: string, check: boolean): Promise<void> => {
  const path = join(sdk, "uv.lock")
  const source = await readFile(path, "utf8")
  if (check) {
    if (!source.includes('version = "1.2.3"')) {
      throw new Error("lock drift")
    }
    return
  }
  await writeFile(
    path,
    source.replace('version = "0.0.1"', 'version = "1.2.3"')
  )
}

test("sync updates every Python release version and is idempotent", async () => {
  await withRepository(async (repository) => {
    const first = await syncPythonVersion(repository, updateLock)
    expect(first).toEqual({
      changed: [
        "sdks/python/pyproject.toml",
        "sdks/python/src/gpt_workflow/_version.py",
        "sdks/python/scripts/verify-package.py",
        "sdks/python/README.md",
        "sdks/python/uv.lock"
      ],
      version: "1.2.3"
    })
    expect(await syncPythonVersion(repository, updateLock)).toEqual({
      changed: [],
      version: "1.2.3"
    })
    await expect(checkPythonVersion(repository, updateLock)).resolves.toEqual({
      changed: [],
      version: "1.2.3"
    })
  })
})

test("check rejects drift without mutating it", async () => {
  await withRepository(async (repository) => {
    await expect(checkPythonVersion(repository, updateLock)).rejects.toThrow(
      "Python version drift"
    )
    expect(
      await readFile(join(repository, "sdks/python/pyproject.toml"), "utf8")
    ).toBe('version = "0.0.1"\n')
  })
})

test("sync rejects malformed canonical versions", async () => {
  await withRepository(async (repository) => {
    await writeFile(
      join(repository, "package.json"),
      JSON.stringify({ name: "gpt-workflow", version: "latest" })
    )
    await expect(syncPythonVersion(repository, updateLock)).rejects.toThrow(
      "stable x.y.z version"
    )
  })
})
