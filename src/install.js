const request = require('request-promise-native')
const ProgressBar = require('progress')
const AdmZip = require('adm-zip')
const fs = require('fs-extra')
const path = require('path')
const url = require('url')
const packageJSON = require('../package.json')

const sapui5Version = packageJSON.sapui5.version
let downloadURL = url.parse(`https://tools.hana.ondemand.com/additional/sapui5-rt-${sapui5Version}.zip`)
const versionURL = url.parse('https://sapui5.hana.ondemand.com/resources/sap-ui-version.json')
const libDir = path.resolve(`${__dirname}/../lib`)
const downloadDir = path.resolve(`${__dirname}/../tmp`)
const zipPath = path.resolve(`${downloadDir}/sapui5.zip`)

Promise.all([request(versionURL.href), fs.remove(libDir), fs.remove(downloadDir)])
  .then((data) => {
    if (typeof sapui5Version === 'undefined' || sapui5Version === 'latest') {
      const latestVersion = JSON.parse(data[0]).version
      downloadURL = url.parse(`https://tools.hana.ondemand.com/additional/sapui5-rt-${latestVersion}.zip`)
    }
    const mkdirDownloadDir = fs.mkdir(downloadDir)
    const mkdirLibDir = fs.mkdirp(libDir)
    return Promise.all([mkdirDownloadDir, mkdirLibDir])
  })
  .then(() => new Promise((resolve, reject) => {
    const options = {
      url: downloadURL,
      headers: {
        Cookie: 'eula_3_1_agreed=tools.hana.ondemand.com/developer-license-3_1.txt',
      },
    }
    console.warn('By using this npm package you agree to the EULA from SAP: https://tools.hana.ondemand.com/developer-license-3_1.txt/')
    request(options)
      .on('response', (response) => {
        const bar = new ProgressBar('Downloading: [:bar] :rate/bps :percent :etas', {
          complete: '=',
          incomplete: ' ',
          width: 20,
          total: parseInt(response.headers['content-length'], 10),
        })
        response.on('data', (data) => {
          bar.tick(data.length)
        })
      })
      .on('error', (error) => {
        reject(error)
      })
      .on('end', () => {
        resolve()
      })
      .pipe(fs.createWriteStream(zipPath))
  }))
  .then(() => {
    console.log('Extracting...')
    return new Promise((resolve) => {
      const zip = new AdmZip(zipPath)
      zip.extractAllTo(libDir, true)
      resolve()
    })
  })
  .then(() => {
    console.log('Cleanup...')
    return fs.remove(downloadDir)
  })
  .catch((error) => {
    console.log('Installation failed:')
    console.log(error)
  })
