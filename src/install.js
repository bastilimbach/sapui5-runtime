const fs = require('fs-extra')
const path = require('path')
const url = require('url')
const StreamZip = require('node-stream-zip')

const axios = require('axios')
const ProgressBar = require('progress')
const tunnel = require('tunnel')

let agent
if (!process.env.HTTPS_PROXY && process.env.HTTP_PROXY) {
    const httpsProxyObject = new Url(process.env.HTTP_PROXY) \
    const hostname = httpsProxyObject.hostname
    const port = httpsProxyObject.port
    if (httpsProxyObject.username && httpsProxyObject.password) {
        const proxyAuth = httpsProxyObject.username + ':' + httpsProxyObject.password
        agent = tunnel.httpsOverHttp({
            proxy: {
                host: hostname,
                port,
                proxyAuth,
            },
        })
    }
    else {
        agent = tunnel.httpsOverHttp({
            proxy: {
                host: hostname,
                port,
            },
        })
    }
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
  let response
  try {
    if (agent) {
      response = await axios.get(downloadURL, {
        responseType: 'stream',
        headers: {
          Cookie: 'eula_3_1_agreed=tools.hana.ondemand.com/developer-license-3_1.txt',
        },
        httpsAgent: agent,
        proxy: false,

      })
    } else {
      response = await axios.get(downloadURL, {
        responseType: 'stream',
        headers: {
          Cookie: 'eula_3_1_agreed=tools.hana.ondemand.com/developer-license-3_1.txt',
        },
      })
    }

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
      response.data.on('error', () => {
        reject()
      })
    })
  } catch (downloadError) {
    throw new Error(`Couldn't download SAPUI5 zip archive from '${downloadURL}'`)
  }
}

async function extractArchive(archive, targetPath) {
  console.log(`Extracting files to  ${targetPath}`)

  const zip = new StreamZip({
    file: archive,
    storeEntries: true,
  })


  zip.on('ready', () => {
    console.log(`All entries read: ${zip.entriesCount}`)

    const progressBar1 = new ProgressBar('Extracting: [:bar]', {

      total: zip.entriesCount,
    })
    zip.on('extract', () => {
      progressBar1.tick()
      if (progressBar1.complete) {
        console.log('SAPUI5 Installed')
      }
    })
    zip.extract(null, targetPath, () => {
      zip.close()
    })
  })
}

const libDir = (config.dest) ? path.resolve(`${__dirname}/../../../`, config.dest) : path.resolve(`${__dirname}/../lib`)
const downloadDir = path.resolve(`${__dirname}/../tmp`)
const versionEndpoint = url.parse('https://sapui5.hana.ondemand.com/resources/sap-ui-version.json')
const downloadEndpoint = url.parse('https://tools.hana.ondemand.com/additional/')
let latestVersionURL = ''

async function installSAPUI5() {
  try {
    await prepareFileSystem(libDir, downloadDir)

    await downloadSAPUI5(latestVersionURL, downloadDir).then((sapui5Archive) => {
      extractArchive(sapui5Archive, libDir)
    }).catch((error) => {
      console.log(error.message)
    })
  } catch (error) {
    console.log(error)
    fs.remove(libDir)
    throw error
  }
  fs.remove(downloadDir)
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
