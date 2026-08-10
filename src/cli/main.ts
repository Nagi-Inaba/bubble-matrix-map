import { normalizeCliError, parseCliArgs, toErrorReceipt } from './args'
import { executeCli } from './workflow'

async function main(): Promise<void> {
  try {
    const result = await executeCli(parseCliArgs(process.argv.slice(2)))
    process.stdout.write(`${typeof result === 'string' ? result : JSON.stringify(result)}\n`)
  } catch (error) {
    const cliError = normalizeCliError(error)
    process.stderr.write(`${JSON.stringify(toErrorReceipt(cliError))}\n`)
    process.exitCode = cliError.exitCode
  }
}

void main()
