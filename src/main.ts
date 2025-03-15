import * as core from "@actions/core"
import * as glob from "@actions/glob"
import * as fs from "fs"
import * as path from "path"

export interface Inputs {
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
    const inputs = getInputs()
    const text = await generateText(inputs)
    core.setOutput("text", text)
    core.info("Directory structure and file contents generated")
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message)
    } else {
      core.setFailed("An unknown error occurred")
    }
  }
}

function getInputs(): Inputs {
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

async function generateText(inputs: Inputs): Promise<string> {
  const filePaths = await getFilePaths(inputs)
  const fileContents = await Promise.all(filePaths.map(getFileContents))
  const tree = generateDirectoryStructure(filePaths)
  let output = `Directory Structure:\n\n${formatDirectoryStructure(tree, "")}`
  for (let i = 0; i < filePaths.length; i++) {
    output += formatFile(filePaths[i], fileContents[i])
  }
  return output
}

async function getFilePaths({ include, exclude }: Inputs): Promise<string[]> {
  const globber = await glob.create(include.join("\n"))
  let filePaths = await globber.glob()
  if (exclude.length > 0) {
    const excludeGlobber = await glob.create(exclude.join("\n"))
    const excludedFilePaths = new Set(await excludeGlobber.glob())
    filePaths = filePaths.filter((p) => !excludedFilePaths.has(p))
  }
  const fileInfo = await Promise.all(filePaths.map((p) => fs.promises.stat(p)))
  filePaths = filePaths.filter((_, i) => fileInfo[i].isFile())
  return filePaths.sort()
}

async function getFileContents(filePath: string): Promise<string> {
  try {
    return await fs.promises.readFile(filePath, "utf8")
  } catch (error) {
    core.warning(`Error reading file ${filePath}: ${error}`)
    return "@@ERROR READING FILE@@"
  }
}

function generateDirectoryStructure(filePaths: string[]): TreeNode {
  const root: TreeNode = { name: "", children: [], isFile: false }

  for (const p of filePaths) {
    let current = root

    const relPath = path.isAbsolute(p) ? path.relative(process.cwd(), p) : p
    const parts = relPath.split(path.sep)

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

function formatDirectoryStructure(node: TreeNode, prefix: string): string {
  let result = ""
  const children = [...node.children]

  children.sort((a, b) => a.name.localeCompare(b.name))

  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    const isLast = i === children.length - 1
    const linePrefix = isLast ? "└── " : "├── "
    const childPrefix = isLast ? "    " : "│   "

    result += `${prefix}${linePrefix}${child.name}\n`

    if (!child.isFile && child.children.length > 0) {
      result += formatDirectoryStructure(child, prefix + childPrefix)
    }
  }

  return result
}

function formatFile(filePath: string, content: string): string {
  const relPath = path.isAbsolute(filePath)
    ? path.relative(process.cwd(), filePath)
    : filePath
  return `\n\n---\nFile: ${relPath}\n---\n\n${content}`
}

export const exportForTesting = {
  generateText,
  getInputs,
  getFilePaths,
  getFileContents,
  buildTree: generateDirectoryStructure,
  convertTreeToString: formatDirectoryStructure
}
