const fs = require('fs-extra')
const path = require('path')
const Downloader = require('./Downloader')

const packageJSONPath = path.resolve(`${__dirname}/../../../package.json`)
let config
try {
  const packageJSON = require(packageJSONPath)
  config = packageJSON['sapui5-runtime'] || {}
} catch (error) {
  config = {}
}

const libDir = path.resolve(`${__dirname}/../lib`)
const tmpDir = path.resolve(`${__dirname}/../tmp`)
let selectedSAPUI5Version = config.version;

(async () => {
  const downloader = new Downloader('Runtime', tmpDir, libDir)

  if (!selectedSAPUI5Version) {
    try {
      selectedSAPUI5Version = await downloader.getLatestVersion()
    } catch (error) {
      console.error(error.message)
      process.exit()
    }
  }

  try {
    const sapUIVersionFile = await fs.readFile(path.resolve(`${libDir}/resources/sap-ui-version.json`))
    const installedSAPUI5Version = JSON.parse(sapUIVersionFile.toString('utf8')).version
    if (installedSAPUI5Version === selectedSAPUI5Version) {
      console.log(`SAPUI5 version ${installedSAPUI5Version} already installed.`)
    } else {
      const zipFile = await downloader.downloadSAPUI5(selectedSAPUI5Version)
      await downloader.extractSAPUI5(zipFile)
    }
  } catch (readFileError) {
    if (readFileError.code === 'ENOENT') {
      const zipFile = await downloader.downloadSAPUI5(selectedSAPUI5Version)
      await downloader.extractSAPUI5(zipFile)
    } else {
      throw readFileError
    }
  }
})()
