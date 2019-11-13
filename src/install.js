const fs = require('fs-extra')
const path = require('path')
const url = require('url')
const StreamZip = require('node-stream-zip')

const axios = require('axios')
const ProgressBar = require('progress')
const tunnel = require('tunnel')

let agent
if (process.env.HTTP_PROXY) {
  const httpsProxyObject = new URL(process.env.HTTP_PROXY)
  const { hostname } = httpsProxyObject
  const { port } = httpsProxyObject
  agent = tunnel.httpsOverHttp({
            proxy: {
              host: httpsProxyObject.hostname,
              port: httpsProxyObject.port,
              proxyAuth: httpsProxyObject.auth
            },
          })
}
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
  try {
    const {
      data: versionData,
    } = await axios.get(versionEndpoint)
    const patchHistory = [
      ...new Set([...versionData.libraries[0].patchHistory, versionData.version].reverse()),
    ]
    const testedVersions = []
    /* eslint-disable no-await-in-loop */
    for (let i = 0; i < patchHistory.length; i += 1) {
      try {
        const downloadURL = url.resolve(downloadEndpoint.href, `sapui5-rt-${patchHistory[i]}.zip`)
        await axios.get(downloadURL)
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
  } catch (error) {
    throw new Error(`Could not receive SAPUI5 versions. Does the file 'sap-ui-version.json' exists at '${url.parse(versionEndpoint).href}'?`)
  }
}

async function downloadSAPUI5(downloadURL, downloadPath) {
  console.warn('By using this npm package you agree to the EULA from SAP: https://tools.hana.ondemand.com/developer-license-3_1.txt/')
  console.log('Downloading SAPUI5...')
  const zipFile = path.join(downloadPath, 'sapui5.zip')
  try {
    const requestConfig = {
      responseType: 'stream',
      headers: {
        Cookie: 'eula_3_1_agreed=tools.hana.ondemand.com/developer-license-3_1.txt',
      },
    }

    if (agent) {
      console.log('using agent')
      requestConfig.httpsAgent = agent
      requestConfig.proxy = false
    }

    const response = await axios.get(downloadURL, requestConfig)

    const progressBar = new ProgressBar('Downloading: [:bar] :rate/bps :percent :etas', {
      complete: '=',
      incomplete: ' ',
      width: 20,
      total: parseInt(response.headers['content-length'], 10),
    })

    response.data.on('data', (data) => {
      progressBar.tick(data.length)
    })

    response.data.pipe(fs.createWriteStream(zipFile))
    return new Promise((resolve, reject) => {
      response.data.on('end', () => {
        resolve(zipFile)
      })
      response.data.on('error', reject)
    })
  } catch (downloadError) {
    throw new Error(`Couldn't download SAPUI5 zip archive from '${downloadURL}'`)
  }
}

async function extractArchive(archive, targetPath, downloadDir) {
  console.log(`Extracting files to  ${targetPath}`)

  const zip = new StreamZip({
    file: archive,
    storeEntries: true,
  })


  zip.on('ready', () => {
    console.log(`All entries read: ${zip.entriesCount}`)

    const extractionProgressBar = new ProgressBar('Extracting: [:bar]', {

      total: zip.entriesCount,
    })
    zip.on('extract', () => {
      extractionProgressBar.tick()
    })
    zip.extract(null, targetPath, () => {
      zip.close(() => {
        console.log('SAPUI5 Installed')
        fs.remove(downloadDir)
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
    console.log(error)
    fs.remove(libDir)
    throw error
  }
}

(async () => {
  if (!config.version) {
    latestVersionURL = await determineLatestVersionURL(versionEndpoint, downloadEndpoint)
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
