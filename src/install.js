const fs = require('fs-extra')
const path = require('path')
const url = require('url')
const StreamZip = require('node-stream-zip')
const request = require('request')
const rpn = require('request-promise-native')
const ProgressBar = require('progress')

const packageJSONPath = path.resolve(`${__dirname}/../../../package.json`)
let config
try {
  const packageJSON = require(packageJSONPath)
  config = packageJSON['sapui5-runtime'] || {}
} catch (error) {
  config = {}
}

async function prepareFileSystem(lib, download) {
  await fs.remove(lib)
  fs.mkdirp(lib)
  await fs.remove(download)
  fs.mkdirp(download)
}

async function determineLatestVersionURL(versionEndpoint, downloadEndpoint) {
  console.log('Searching for latest SAPUI5 version...')
  const versionData = await rpn({ url: versionEndpoint.href, json: true })
  const patchHistory = [
    ...new Set([...versionData.libraries[0].patchHistory, versionData.version].reverse()),
  ]
  const testedVersions = []
  /* eslint-disable no-await-in-loop */
  for (let i = 0; i < patchHistory.length; i += 1) {
    try {
      const downloadURL = url.resolve(downloadEndpoint.href, `sapui5-rt-${patchHistory[i]}.zip`)
      await rpn({ url: downloadURL, json: true })
      console.log(`SAPUI5 version ${patchHistory[i]} found.`)
      return downloadURL
    } catch (versionError) {
      testedVersions.push({
        version: patchHistory[i],
        url: url.resolve(downloadEndpoint.href, `sapui5-rt-${patchHistory[i]}.zip`),
      })
    }
  }
  throw new Error(`Could not determine the available SAPUI5 version. Is the file 'sapui5-rt-{version}.zip' available at '${downloadEndpoint.href}'?
    I tried the following versions: ${JSON.stringify(testedVersions, null, 2)}`)
}

async function downloadSAPUI5(downloadURL, downloadPath) {
  console.warn('By using this npm package you agree to the EULA from SAP: https://tools.hana.ondemand.com/developer-license-3_1.txt/')
  console.log('Downloading SAPUI5...')
  const zipFile = path.join(downloadPath, 'sapui5.zip')
  let downloadProgressBar

  return new Promise((resolve, reject) => {
    const req = request({
      url: downloadURL,
      headers: {
        Cookie: 'eula_3_1_agreed=tools.hana.ondemand.com/developer-license-3_1.txt',
      },
    })

    req
      .on('response', (response) => {
        downloadProgressBar = new ProgressBar('Downloading: [:bar] :rate/bps :percent :etas', {
          complete: '=',
          incomplete: ' ',
          width: 20,
          total: parseInt(response.headers['content-length'], 10),
        })
      })
      .on('data', (data) => {
        if (downloadProgressBar instanceof ProgressBar) {
          downloadProgressBar.tick(data.length)
        }
      })
      .on('end', () => {
        resolve(zipFile)
      })
      .on('error', reject)
      .pipe(fs.createWriteStream(zipFile))
  })
}

async function extractArchive(archive, targetPath, downloadDir) {
  console.log(`Extracting files to ${targetPath}`)

  const zip = new StreamZip({
    file: archive,
    storeEntries: true,
  })

  zip.on('ready', () => {
    const extractionProgressBar = new ProgressBar('Extracting: [:bar] :percent :etas', {
      complete: '=',
      incomplete: ' ',
      width: 20,
      total: zip.entriesCount,
    })

    zip.on('extract', () => {
      extractionProgressBar.tick()
    })

    zip.extract(null, targetPath, () => {
      zip.close(() => {
        fs.remove(downloadDir)
        console.log('\nSAPUI5 installed')
      })
    })
  })
}

const libDir = path.resolve(`${__dirname}/../lib`)
const downloadDir = path.resolve(`${__dirname}/../tmp`)
const versionEndpoint = url.parse('https://sapui5.hana.ondemand.com/resources/sap-ui-version.json')
const downloadEndpoint = url.parse('https://tools.hana.ondemand.com/additional/')
let latestVersionURL = ''

async function installSAPUI5() {
  try {
    await prepareFileSystem(libDir, downloadDir)
    const sapui5Archive = await downloadSAPUI5(latestVersionURL, downloadDir)
    await extractArchive(sapui5Archive, libDir, downloadDir)
  } catch (error) {
    console.error(error.message)
    fs.remove(libDir)
    process.exit()
  }
}

(async () => {
  if (!config.version) {
    try {
      latestVersionURL = await determineLatestVersionURL(versionEndpoint, downloadEndpoint)
    } catch (error) {
      console.error(error.message)
      process.exit()
    }
  } else {
    latestVersionURL = url.resolve(downloadEndpoint.href, `sapui5-rt-${config.version}.zip`)
  }

  try {
    const sapUIVersionFile = await fs.readFile(path.resolve(`${libDir}/resources/sap-ui-version.json`))
    const parsedVersionFile = JSON.parse(sapUIVersionFile.toString('utf8'))
    const installedSAPUI5VersionURL = url.resolve(downloadEndpoint.href, `sapui5-rt-${parsedVersionFile.version}.zip`)
    if (installedSAPUI5VersionURL === latestVersionURL) {
      console.log(`SAPUI5 version ${parsedVersionFile.version} already installed.`)
    } else {
      await installSAPUI5()
    }
  } catch (readFileError) {
    if (readFileError.code === 'ENOENT') {
      await installSAPUI5()
    } else {
      throw readFileError
    }
  }
})()
