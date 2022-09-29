import { resolve, join } from 'path'
import pino from 'pino'
import pretty from 'pino-pretty'
import { execa } from 'execa'
import loadConfig from './load-config.mjs'
import { isFileAccessible } from './utils.js'

async function getTSCExecutablePath (cwd) {
  const [npmBinLocalFolder, npmBinGlobalFolder] = await Promise.all([
    execa('npm', ['bin'], { cwd }).then((result) => result.stdout),
    execa('npm', ['bin', '-g'], { cwd }).then((result) => result.stdout)
  ])

  const tscLocalPath = join(npmBinLocalFolder, 'tsc')
  const tscGlobalPath = join(npmBinGlobalFolder, 'tsc')

  const [tscLocalExists, tscGlobalExists] = await Promise.all([
    isFileAccessible(tscLocalPath),
    isFileAccessible(tscGlobalPath)
  ])

  /* c8 ignore next 3 */
  if (tscLocalExists) {
    return tscLocalPath
  }

  if (tscGlobalExists) {
    return tscGlobalPath
  }
}

async function execute (logger, args, config) {
  const cwd = process.cwd()

  const tscExecutablePath = await getTSCExecutablePath(cwd)
  /* c8 ignore next 4 */
  if (tscExecutablePath === undefined) {
    throw new Error('The tsc executable was not found.')
  }

  const tsconfigPath = resolve(cwd, 'tsconfig.json')
  const tsconfigExists = await isFileAccessible(tsconfigPath)

  if (!tsconfigExists) {
    throw new Error('The tsconfig.json file was not found.')
  }

  try {
    await execa(tscExecutablePath, ['--project', 'tsconfig.json'], { cwd })
    logger.info('Typescript compilation completed successfully.')
  } catch (error) {
    throw new Error('Failed to compile typescript files: ' + error)
  }
}

async function compileWatch () {
  const logger = pino(
    pretty({
      translateTime: 'SYS:HH:MM:ss',
      ignore: 'hostname,pid'
    })
  )

  const cwd = process.cwd()

  const tscExecutablePath = await getTSCExecutablePath(cwd)
  /* c8 ignore next 4 */
  if (tscExecutablePath === undefined) {
    logger.error('The tsc executable was not found.')
    process.exit(1)
  }

  const tsconfigPath = resolve(cwd, 'tsconfig.json')
  const tsconfigExists = await isFileAccessible(tsconfigPath)

  if (!tsconfigExists) {
    logger.error('The tsconfig.json file was not found.')
    process.exit(1)
  }

  let isCompiled = false
  return new Promise((resolve, reject) => {
    const child = execa(tscExecutablePath, ['--project', 'tsconfig.json', '--watch'], { cwd })

    let tsCompilationMessages = []

    child.stdout.on('data', (data) => {
      let tsCompilerMessage = data.toString().trim()
      if (tsCompilerMessage.startsWith('\u001bc')) {
        tsCompilerMessage = tsCompilerMessage.slice(2)
      }

      if (tsCompilerMessage === '') return

      const startMessage = tsCompilerMessage.match(/.*Starting compilation in watch mode.../)
      if (startMessage !== null) {
        logger.info(tsCompilerMessage)
        return
      }

      tsCompilationMessages.push(tsCompilerMessage)

      const resultMessage = tsCompilerMessage.match(/.*Found (\d+) error.*/)
      if (resultMessage !== null) {
        const errorsCount = parseInt(resultMessage[1])
        const compilerOutput = tsCompilationMessages.join('\n')
        /* c8 ignore next 6 */
        if (errorsCount === 0) {
          logger.info(compilerOutput)
          if (!isCompiled) {
            isCompiled = true
            resolve()
          }
        } else {
          logger.error(compilerOutput)
          if (!isCompiled) {
            reject(new Error('Typescript compilation failed.'))
          }
        }
        tsCompilationMessages = []
      }
    })
  })
}

async function compile (_args) {
  const logger = pino(
    pretty({
      translateTime: 'SYS:HH:MM:ss',
      ignore: 'hostname,pid'
    })
  )

  const { configManager, args } = await loadConfig({}, _args)
  await configManager.parseAndValidate()
  const config = configManager.current

  try {
    await execute(logger, args, config)
  } catch (error) {
    logger.error(error.message)
    process.exit(1)
  }
}

export { compile, compileWatch, execute }
