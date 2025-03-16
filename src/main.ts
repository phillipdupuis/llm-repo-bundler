import * as core from "@actions/core"
import * as glob from "@actions/glob"
import * as fs from "fs"
import * as path from "path"

export interface Config {
  include: string[]
  exclude: string[]
}

export interface TreeNode {
  name: string
  children: TreeNode[]
  isFile: boolean
}

export async function run(): Promise<void> {
  try {
    const config = getConfig()
    const text = await bundleRepo(config)
    core.setOutput("result", text)
    core.info("Directory structure and file contents generated")
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message)
    } else {
      core.setFailed("An unknown error occurred")
    }
  }
}

export async function bundleRepo(config: Config): Promise<string> {
  const description = getDescription(config)
  const filePaths = await getFilePaths(config)
  const directoryStructure = getDirectoryStructure(filePaths)
  const chunks = await Promise.all([
    description,
    directoryStructureAsXML(directoryStructure),
    "<files>",
    ...filePaths.map(fileAsXML),
    "</files>"
  ])
  return chunks.join("\n")
}

function getConfig(): Config {
  const include = core
    .getInput("include")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  const exclude = core
    .getInput("exclude")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  return { include, exclude }
}

function getDescription(config: Config) {
  let description =
    "This is a merged representation of the files in the repository.\n\n"
  description += "It includes the files matching the following glob patterns:\n"
  description += config.include.map((p) => `  - ${p}`).join("\n")
  description += "\n\n"
  if (config.exclude.length > 0) {
    description +=
      "Files matching any of the following glob patterns are excluded:\n"
    description += config.exclude.map((p) => `  - ${p}`).join("\n")
    description += "\n\n"
  }
  description +=
    "The directory structure is shown first, followed by the contents of each file.\n\n"
  return description
}

async function getFilePaths({ include, exclude }: Config): Promise<string[]> {
  const globber = await glob.create(include.join("\n"))
  let paths = await globber.glob()
  if (exclude.length > 0) {
    const excludeGlobber = await glob.create(exclude.join("\n"))
    const excludedFilePaths = new Set(await excludeGlobber.glob())
    paths = paths.filter((p) => !excludedFilePaths.has(p))
  }
  const fileInfo = await Promise.all(paths.map((p) => fs.promises.stat(p)))
  paths = paths.filter((_, i) => fileInfo[i].isFile())
  paths.sort()
  return paths
}

function getDirectoryStructure(filePaths: string[]): TreeNode {
  const root: TreeNode = { name: "", children: [], isFile: false }
  const relativePaths = filePaths
    .map((p) => (path.isAbsolute(p) ? path.relative(process.cwd(), p) : p))
    .sort()
  for (const p of relativePaths) {
    let current = root
    const parts = p.split(path.sep)
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      let node = current.children.find((c) => c.name === part)
      if (node === undefined) {
        node = { name: part, children: [], isFile: i === parts.length - 1 }
        current.children.push(node)
      }
      current = node
    }
  }
  return root
}

function directoryStructureAsXML(node: TreeNode, prefix: string = ""): string {
  let text = ""
  const children = [...node.children].sort()
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    const isLast = i === children.length - 1
    const linePrefix = isLast ? "└── " : "├── "
    const childPrefix = isLast ? "    " : "│   "
    text += `${prefix}${linePrefix}${child.name}\n`
    if (!child.isFile && child.children.length > 0) {
      text += directoryStructureAsXML(child, prefix + childPrefix)
    }
  }
  return prefix ? text : `<directory_structure>\n${text}</directory_structure>`
}

/** Return attributes/metadata to display for the file */
async function getFileAttributes(
  filePath: string
): Promise<Record<string, string>> {
  const relativePath = path.isAbsolute(filePath)
    ? path.relative(process.cwd(), filePath)
    : filePath
  return { path: relativePath }
}

async function getFileContents(filePath: string): Promise<string> {
  try {
    const text = await fs.promises.readFile(filePath, "utf8")
    return text
  } catch (error) {
    core.warning(`Error reading file ${filePath}: ${error}`)
    return "@@ERROR READING FILE@@"
  }
}

async function fileAsXML(filePath: string): Promise<string> {
  const attributes = await getFileAttributes(filePath)
  const content = await getFileContents(filePath)
  let openTag = `<file`
  for (const [key, value] of Object.entries(attributes)) {
    openTag += ` ${key}="${value}"`
  }
  openTag += ">"
  return `${openTag}\n${content}</file>`
}

export const exportForTesting = {
  bundleRepo,
  directoryStructureAsXML,
  fileAsXML,
  getConfig,
  getDirectoryStructure,
  getFileAttributes,
  getFileContents,
  getFilePaths
}
