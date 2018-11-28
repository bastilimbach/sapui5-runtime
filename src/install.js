const fs = require('fs-extra')
const path = require('path')
const url = require('url')
const AdmZip = require('adm-zip')
const axios = require('axios')
const ProgressBar = require('progress')

async function prepareFileSystem(lib, download) {
  await fs.remove(lib)
  fs.mkdirp(lib)
  await fs.remove(download)
  fs.mkdirp(download)
}

async function determineLatestVersionURL(versionEndpoint, downloadEndpoint) {
  console.log('Searching for latest SAPUI5 version...')
  try {
    const { data: versionData } = await axios.get(versionEndpoint)
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
  const zipFile = path.join(downloadPath, 'sapui5.zip')
  try {
    const response = await axios.get(downloadURL, {
      responseType: 'stream',
      headers: {
        Cookie: 'eula_3_1_agreed=tools.hana.ondemand.com/developer-license-3_1.txt',
      },
    })

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
      response.data.on('end', () => { resolve(zipFile) })
      response.data.on('error', () => { reject() })
    })
  } catch (downloadError) {
    throw new Error(`Couldn't download SAPUI5 zip archive from '${downloadURL}'`)
  }
}

async function extractArchive(archive, targetPath) {
  console.log('Extracting...')
  const zip = new AdmZip(archive)
  zip.extractAllTo(targetPath, true)
}

const libDir = path.resolve(`${__dirname}/../lib`)
const downloadDir = path.resolve(`${__dirname}/../tmp`)
const versionEndpoint = url.parse('https://sapui5.hana.ondemand.com/resources/sap-ui-version.json')
const downloadEndpoint = url.parse('https://tools.hana.ondemand.com/additional/');

(async () => {
  let latestVersionURL
  // Check if a specific Version of UI5 is needed..
  // we are in node_modules/sapui5-runtime/src and need to go down to project using our module
  const pathToRootPackageJson = path.join(__dirname, '../../../package.json')
  const packageJson = require(pathToRootPackageJson)

  if (packageJson && packageJson.sapui5RuntimeVersion) {
    latestVersionURL = url.resolve(downloadEndpoint.href, `sapui5-rt-${packageJson.sapui5RuntimeVersion}.zip`)
  }

  prepareFileSystem(libDir, downloadDir)

  try {
    if (!latestVersionURL) latestVersionURL = await determineLatestVersionURL(versionEndpoint, downloadEndpoint)
    const sapui5Archive = await downloadSAPUI5(latestVersionURL, downloadDir)
    await extractArchive(sapui5Archive, libDir)
  } catch (error) {
    fs.remove(libDir)
    console.error(error.message)
  }

  fs.remove(downloadDir)
  console.log('Successfully downloaded SAPUI5!')
})()
